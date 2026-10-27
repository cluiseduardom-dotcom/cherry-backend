const estoqueRepository = require('./estoqueRepository');

// Consumo automático de insumos por venda (#150, fatia 1b). Tudo aqui roda DENTRO da transação da venda
// (ou do cancelamento) — por isso o `client` é obrigatório e este módulo nunca abre/fecha transação.
// Regras: o insumo só sai do Central; a falta de saldo NÃO bloqueia a venda (baixa o que existe e grava a
// pendência); o snapshot guarda quantidade prevista, baixada e custo da época; cancelar devolve o baixado.

// Fichas de venda VIGENTES dos produtos vendidos, uma linha por insumo da ficha. Sem trava: a ficha é versionada
// (nunca editada), então a leitura é consistente; trocar de versão durante a venda vale na próxima.
async function buscarFichasVigentes(produtoIds, empresa_id, client) {
    if (!produtoIds.length) return [];

    const { rows } = await client.query(
        `SELECT f.id AS ficha_venda_id, f.produto_id, i.insumo_produto_id, i.quantidade
         FROM fichas_venda f
         JOIN itens_ficha_venda i ON i.ficha_venda_id = f.id AND i.empresa_id = f.empresa_id
         WHERE f.empresa_id = $1 AND f.vigente = true AND f.produto_id = ANY($2::int[])
         ORDER BY f.produto_id, i.insumo_produto_id`,
        [empresa_id, produtoIds]
    );

    return rows;
}

// Calcula o que cada venda consome: quantidade vendida do produto × quantidade da ficha. Puro (sem banco).
function calcularConsumosPrevistos(itensVendidos, fichas) {
    const vendidoPorProduto = new Map();
    for (const item of itensVendidos) {
        vendidoPorProduto.set(item.produto_id, (vendidoPorProduto.get(item.produto_id) ?? 0) + item.quantidade);
    }

    return fichas
        .filter((linha) => vendidoPorProduto.has(linha.produto_id))
        .map((linha) => ({
            ficha_venda_id: linha.ficha_venda_id,
            produto_id: linha.insumo_produto_id,
            quantidade_prevista: vendidoPorProduto.get(linha.produto_id) * linha.quantidade
        }))
        .sort((a, b) => a.produto_id - b.produto_id || a.ficha_venda_id - b.ficha_venda_id);
}

// Baixa cada linha prevista no Central (só o que houver de saldo) e grava o snapshot em venda_consumos.
// Serve à venda (origem 'ficha') e aos ajustes por venda (acrescentar: brinde/substituicao/outro).
// `previstos`: [{ ficha_venda_id, produto_id, quantidade_prevista, origem, observacao }], já ordenados por insumo.
// Os produtos já devem estar travados (a venda os trava em ordem de id; ajustes travam a venda e o insumo).
// Devolve as pendências (linhas com falta) e as linhas gravadas.
async function baixarLinhasDeConsumo({ venda_id, previstos, usuario_id, empresa_id, motivoMovimentacao }, client) {
    if (!previstos.length) return { pendencias: [], linhas: [] };

    const centralId = await estoqueRepository.garantirLocalCentral(client, empresa_id);
    const insumoIds = [...new Set(previstos.map((p) => p.produto_id))];

    const { rows: insumoRows } = await client.query(
        'SELECT id, custo FROM produtos WHERE empresa_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE',
        [empresa_id, insumoIds]
    );
    const custoPorInsumo = new Map(insumoRows.map((r) => [r.id, r.custo]));

    const { rows: saldoRows } = await client.query(
        'SELECT produto_id, saldo FROM estoque_locais WHERE empresa_id = $1 AND local_id = $2 AND produto_id = ANY($3::int[])',
        [empresa_id, centralId, insumoIds]
    );
    const saldoRestante = new Map(saldoRows.map((r) => [r.produto_id, r.saldo]));

    const pendencias = [];
    const linhas = [];

    for (const previsto of previstos) {
        if (!custoPorInsumo.has(previsto.produto_id)) continue;

        const saldo = saldoRestante.get(previsto.produto_id) ?? 0;
        const baixar = Math.min(previsto.quantidade_prevista, Math.max(saldo, 0));

        if (baixar > 0) {
            const resultado = await estoqueRepository.criarMovimentacao({
                produto_id: previsto.produto_id,
                tipo: 'saida',
                quantidade: baixar,
                motivo: motivoMovimentacao ?? `Consumo venda #${venda_id}`,
                usuario_id,
                empresa_id,
                local_id: centralId
            }, client);

            if (resultado.erro) {
                throw new Error(`Falha ao baixar insumo ${previsto.produto_id} da venda ${venda_id}: ${resultado.erro}`);
            }

            saldoRestante.set(previsto.produto_id, saldo - baixar);
        }

        const { rows } = await client.query(
            `INSERT INTO venda_consumos
             (empresa_id, venda_id, produto_id, ficha_venda_id, local_id, origem, quantidade_prevista, quantidade_baixada,
              custo_unitario, observacao, criado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [empresa_id, venda_id, previsto.produto_id, previsto.ficha_venda_id ?? null, centralId,
                previsto.origem ?? 'ficha', previsto.quantidade_prevista, baixar,
                custoPorInsumo.get(previsto.produto_id), previsto.observacao ?? null, usuario_id]
        );
        linhas.push(rows[0]);

        if (baixar < previsto.quantidade_prevista) {
            pendencias.push({
                produto_id: previsto.produto_id,
                quantidade_prevista: previsto.quantidade_prevista,
                quantidade_baixada: baixar,
                quantidade_pendente: previsto.quantidade_prevista - baixar
            });
        }
    }

    return { pendencias, linhas };
}

// Baixa automática da venda: o previsto vem das fichas vigentes. Devolve as pendências.
async function registrarConsumosDaVenda({ venda_id, itensVendidos, fichas, usuario_id, empresa_id }, client) {
    const previstos = calcularConsumosPrevistos(itensVendidos, fichas)
        .map((p) => ({ ...p, origem: 'ficha' }));

    const { pendencias } = await baixarLinhasDeConsumo({ venda_id, previstos, usuario_id, empresa_id }, client);

    return pendencias;
}

// Cancelamento da venda: o que foi baixado volta ao Central (movimentação auditada) e a linha é marcada como
// devolvida (pendências abertas dessa venda deixam de existir para o sino). Nada é apagado.
async function devolverConsumosDaVenda({ venda_id, usuario_id, empresa_id }, client) {
    const { rows } = await client.query(
        `SELECT id, produto_id, local_id, quantidade_baixada
         FROM venda_consumos
         WHERE venda_id = $1 AND empresa_id = $2 AND devolvido_em IS NULL
         ORDER BY produto_id, id
         FOR UPDATE`,
        [venda_id, empresa_id]
    );

    for (const consumo of rows) {
        if (consumo.quantidade_baixada > 0) {
            const resultado = await estoqueRepository.criarMovimentacao({
                produto_id: consumo.produto_id,
                tipo: 'entrada',
                quantidade: consumo.quantidade_baixada,
                motivo: `Devolução consumo venda #${venda_id}`,
                usuario_id,
                empresa_id,
                local_id: consumo.local_id
            }, client);

            if (resultado.erro) {
                throw new Error(`Falha ao devolver insumo ${consumo.produto_id} da venda ${venda_id}: ${resultado.erro}`);
            }
        }

        await client.query(
            `UPDATE venda_consumos SET devolvido_em = NOW(), devolucao_tipo = 'cancelamento', devolvido_por = $3
             WHERE id = $1 AND empresa_id = $2`,
            [consumo.id, empresa_id, usuario_id]
        );
    }

    return rows.length;
}

// Pendências abertas por insumo (vendas finalizadas, não devolvidas), para o sino.
async function listarPendenciasPorInsumo(empresa_id, executor) {
    const { rows } = await executor.query(
        `SELECT p.id AS produto_id, p.sku, p.nome, p.estoque_atual,
                SUM(c.quantidade_prevista - c.quantidade_baixada)::int AS quantidade_pendente,
                COUNT(DISTINCT c.venda_id)::int AS vendas
         FROM venda_consumos c
         JOIN vendas v ON v.id = c.venda_id AND v.empresa_id = c.empresa_id AND v.status = 'finalizada'
         JOIN produtos p ON p.id = c.produto_id AND p.empresa_id = c.empresa_id
         WHERE c.empresa_id = $1 AND c.devolvido_em IS NULL AND c.quantidade_baixada < c.quantidade_prevista
         GROUP BY p.id, p.sku, p.nome, p.estoque_atual
         ORDER BY p.id`,
        [empresa_id]
    );

    return rows;
}

module.exports = {
    baixarLinhasDeConsumo,
    buscarFichasVigentes,
    calcularConsumosPrevistos,
    registrarConsumosDaVenda,
    devolverConsumosDaVenda,
    listarPendenciasPorInsumo
};
