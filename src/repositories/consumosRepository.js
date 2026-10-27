const db = require('../config/db');
const AppError = require('../errors/AppError');
const estoqueRepository = require('./estoqueRepository');
const vendaConsumosRepository = require('./vendaConsumosRepository');
const { executarComLock } = require('./shared/transacoes');

// Consumo de insumos (#150 fatia 1c). Tudo filtrado por empresa_id nas próprias consultas; insumo só do Central;
// estoque nunca negativo; nada é apagado (retirar = devolver ao Central por movimentação auditada).

const FUSO = 'America/Sao_Paulo';

// Insumos ativos com o saldo do Central, para o usuário escolher pelo SKU. Custo só sai se o controller permitir.
async function listarInsumos(empresa_id) {
    const { rows } = await db.query(
        `SELECT p.id, p.sku, p.nome, p.unidade, p.custo, COALESCE(el.saldo, 0)::int AS saldo_central
         FROM produtos p
         LEFT JOIN locais_estoque l ON l.empresa_id = p.empresa_id AND l.tipo = 'central'
         LEFT JOIN estoque_locais el ON el.produto_id = p.id AND el.local_id = l.id AND el.empresa_id = p.empresa_id
         WHERE p.empresa_id = $1 AND p.tipo = 'insumo' AND p.ativo = true
         ORDER BY p.nome, p.id`,
        [empresa_id]
    );

    return rows;
}

// Consumo avulso: uma transação — trava o insumo, valida, grava o registro e a saída do Central.
async function registrarAvulso({ produto_id, quantidade, motivo, responsavel_id, finalidade, observacao, usuario_id, empresa_id }) {
    return executarComLock('produtos', { coluna: 'id', valor: produto_id }, empresa_id, undefined, async (produto, client) => {
        if (!produto) throw new AppError('Insumo não encontrado', 404);
        if (produto.tipo !== 'insumo') throw new AppError("Só produto do tipo 'insumo' tem consumo avulso", 400);
        if (!produto.ativo) throw new AppError('Insumo inativo', 400);

        const responsavelId = responsavel_id ?? usuario_id;
        const { rows: respRows } = await client.query(
            'SELECT id FROM usuarios WHERE id = $1 AND empresa_id = $2 AND ativo = true',
            [responsavelId, empresa_id]
        );
        if (!respRows.length) throw new AppError('Responsável não encontrado', 404);

        const centralId = await estoqueRepository.garantirLocalCentral(client, empresa_id);

        const { rows } = await client.query(
            `INSERT INTO consumos_avulsos
             (empresa_id, produto_id, local_id, quantidade, motivo, responsavel_id, finalidade, observacao, custo_unitario, criado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [empresa_id, produto_id, centralId, quantidade, motivo, responsavelId, finalidade ?? null, observacao ?? null, produto.custo, usuario_id]
        );
        const consumo = rows[0];

        const resultado = await estoqueRepository.criarMovimentacao({
            produto_id,
            tipo: 'saida',
            quantidade,
            motivo: `Consumo avulso #${consumo.id} (${motivo})`,
            usuario_id,
            empresa_id,
            local_id: centralId
        }, client);

        if (resultado.erro === 'ESTOQUE_INSUFICIENTE') throw new AppError('Estoque insuficiente no Central para esse consumo', 409);
        if (resultado.erro) throw new AppError('Não foi possível baixar o insumo', 409);

        return consumo;
    });
}

function condicoesPeriodo({ de, ate, produto_id }, valores, colunaProduto, colunaData) {
    const condicoes = [];
    if (produto_id !== undefined) {
        valores.push(produto_id);
        condicoes.push(`${colunaProduto} = $${valores.length}`);
    }
    if (de !== undefined) {
        valores.push(de);
        condicoes.push(`(${colunaData} AT TIME ZONE '${FUSO}')::date >= $${valores.length}`);
    }
    if (ate !== undefined) {
        valores.push(ate);
        condicoes.push(`(${colunaData} AT TIME ZONE '${FUSO}')::date <= $${valores.length}`);
    }
    return condicoes;
}

// Histórico dos consumos avulsos (quem retirou, para quê, quando).
async function listarAvulsos({ empresa_id, de, ate, produto_id, motivo, limit, offset }) {
    const valores = [empresa_id];
    const condicoes = ['a.empresa_id = $1', ...condicoesPeriodo({ de, ate, produto_id }, valores, 'a.produto_id', 'a.criado_em')];

    if (motivo !== undefined) {
        valores.push(motivo);
        condicoes.push(`a.motivo = $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;
    const { rows } = await db.query(
        `SELECT a.id, a.produto_id, p.sku, p.nome, a.quantidade, a.motivo, a.finalidade, a.observacao, a.custo_unitario,
                a.responsavel_id, ur.nome AS responsavel_nome, a.criado_por, a.criado_em
         FROM consumos_avulsos a
         JOIN produtos p ON p.id = a.produto_id AND p.empresa_id = a.empresa_id
         JOIN usuarios ur ON ur.id = a.responsavel_id AND ur.empresa_id = a.empresa_id
         ${where}
         ORDER BY a.criado_em DESC, a.id DESC
         LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limit, offset]
    );
    const { rows: countRows } = await db.query(`SELECT COUNT(*) FROM consumos_avulsos a ${where}`, valores);

    return { items: rows, total: Number(countRows[0].count) };
}

function estadoDaLinha(linha) {
    if (linha.devolvido_em) return linha.devolucao_tipo === 'retirada' ? 'retirada' : 'cancelamento';
    return linha.quantidade_baixada < linha.quantidade_prevista ? 'pendente' : 'ativa';
}

// Linhas de consumo da venda (snapshot + ajustes), com o estado de cada uma.
async function linhasDaVenda(venda_id, empresa_id) {
    const { rows: vendaRows } = await db.query(
        'SELECT id, status, data FROM vendas WHERE id = $1 AND empresa_id = $2',
        [venda_id, empresa_id]
    );
    if (!vendaRows.length) throw new AppError('Venda não encontrada', 404);

    const { rows } = await db.query(
        `SELECT c.id, c.produto_id, p.sku, p.nome, c.origem, c.quantidade_prevista, c.quantidade_baixada, c.custo_unitario,
                c.observacao, c.criado_em, c.devolvido_em, c.devolucao_tipo
         FROM venda_consumos c
         JOIN produtos p ON p.id = c.produto_id AND p.empresa_id = c.empresa_id
         WHERE c.venda_id = $1 AND c.empresa_id = $2
         ORDER BY c.id`,
        [venda_id, empresa_id]
    );

    return {
        venda: vendaRows[0],
        linhas: rows.map((l) => ({
            ...l,
            quantidade_pendente: l.devolvido_em ? 0 : l.quantidade_prevista - l.quantidade_baixada,
            estado: estadoDaLinha(l)
        }))
    };
}

async function travarVendaFinalizada(venda, mensagemStatus) {
    if (!venda) throw new AppError('Venda não encontrada', 404);
    if (venda.status !== 'finalizada') throw new AppError(mensagemStatus, 409);
}

// Acrescenta um insumo ao consumo de uma venda finalizada (brinde, substituição, outro). Segue a mesma regra da
// venda: baixa o que houver de saldo no Central e deixa o resto como pendência (não bloqueia).
async function acrescentarNaVenda({ venda_id, produto_id, quantidade, motivo, observacao, usuario_id, empresa_id }) {
    return executarComLock('vendas', { coluna: 'id', valor: venda_id }, empresa_id, undefined, async (venda, client) => {
        await travarVendaFinalizada(venda, 'Só é possível ajustar o consumo de vendas finalizadas');

        const { rows: insumoRows } = await client.query(
            'SELECT id, tipo, ativo FROM produtos WHERE id = $1 AND empresa_id = $2',
            [produto_id, empresa_id]
        );
        if (!insumoRows.length) throw new AppError('Insumo não encontrado', 404);
        if (insumoRows[0].tipo !== 'insumo') throw new AppError("Só produto do tipo 'insumo' entra no consumo da venda", 400);
        if (!insumoRows[0].ativo) throw new AppError('Insumo inativo', 400);

        const { pendencias, linhas } = await vendaConsumosRepository.baixarLinhasDeConsumo({
            venda_id,
            previstos: [{ produto_id, quantidade_prevista: quantidade, origem: motivo, observacao }],
            usuario_id,
            empresa_id,
            motivoMovimentacao: `Consumo venda #${venda_id} (${motivo})`
        }, client);

        return { linha: linhas[0], pendencias };
    });
}

// Retira uma linha de consumo (ex.: vendeu sem a embalagem): o baixado volta ao Central e a linha fica marcada
// como retirada (histórico preservado). Só em venda finalizada e em linha ainda não devolvida.
async function retirarLinha({ venda_id, consumo_id, usuario_id, empresa_id }) {
    return executarComLock('vendas', { coluna: 'id', valor: venda_id }, empresa_id, undefined, async (venda, client) => {
        await travarVendaFinalizada(venda, 'Só é possível ajustar o consumo de vendas finalizadas');

        const { rows } = await client.query(
            'SELECT * FROM venda_consumos WHERE id = $1 AND venda_id = $2 AND empresa_id = $3 FOR UPDATE',
            [consumo_id, venda_id, empresa_id]
        );
        if (!rows.length) throw new AppError('Linha de consumo não encontrada', 404);

        const linha = rows[0];
        if (linha.devolvido_em) throw new AppError('Esta linha de consumo já foi devolvida', 409);

        if (linha.quantidade_baixada > 0) {
            const resultado = await estoqueRepository.criarMovimentacao({
                produto_id: linha.produto_id,
                tipo: 'entrada',
                quantidade: linha.quantidade_baixada,
                motivo: `Retirada consumo venda #${venda_id}`,
                usuario_id,
                empresa_id,
                local_id: linha.local_id
            }, client);
            if (resultado.erro) throw new AppError('Não foi possível devolver o insumo ao estoque', 409);
        }

        const { rows: atualizadas } = await client.query(
            `UPDATE venda_consumos SET devolvido_em = NOW(), devolucao_tipo = 'retirada', devolvido_por = $3
             WHERE id = $1 AND empresa_id = $2 RETURNING *`,
            [consumo_id, empresa_id, usuario_id]
        );

        return atualizadas[0];
    });
}

// Regulariza a pendência de uma linha depois da reposição: baixa do Central o que faltou (até o saldo disponível).
async function regularizarLinha({ venda_id, consumo_id, usuario_id, empresa_id }) {
    return executarComLock('vendas', { coluna: 'id', valor: venda_id }, empresa_id, undefined, async (venda, client) => {
        await travarVendaFinalizada(venda, 'Só é possível ajustar o consumo de vendas finalizadas');

        const { rows } = await client.query(
            'SELECT * FROM venda_consumos WHERE id = $1 AND venda_id = $2 AND empresa_id = $3 FOR UPDATE',
            [consumo_id, venda_id, empresa_id]
        );
        if (!rows.length) throw new AppError('Linha de consumo não encontrada', 404);

        const linha = rows[0];
        if (linha.devolvido_em) throw new AppError('Esta linha de consumo já foi devolvida', 409);

        const pendente = linha.quantidade_prevista - linha.quantidade_baixada;
        if (pendente <= 0) throw new AppError('Esta linha não tem pendência', 409);

        // Trava o insumo antes de ler o saldo (mesma ordem de toda movimentação: venda -> produto -> saldo).
        await client.query('SELECT id FROM produtos WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [linha.produto_id, empresa_id]);
        const { rows: saldoRows } = await client.query(
            'SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2 AND empresa_id = $3',
            [linha.produto_id, linha.local_id, empresa_id]
        );
        const saldo = saldoRows.length ? saldoRows[0].saldo : 0;
        const baixar = Math.min(pendente, Math.max(saldo, 0));

        if (baixar <= 0) throw new AppError('Sem saldo do insumo no Central para regularizar. Reponha o estoque primeiro.', 409);

        const resultado = await estoqueRepository.criarMovimentacao({
            produto_id: linha.produto_id,
            tipo: 'saida',
            quantidade: baixar,
            motivo: `Regularização consumo venda #${venda_id}`,
            usuario_id,
            empresa_id,
            local_id: linha.local_id
        }, client);
        if (resultado.erro) throw new AppError('Não foi possível baixar o insumo', 409);

        const { rows: atualizadas } = await client.query(
            'UPDATE venda_consumos SET quantidade_baixada = quantidade_baixada + $3 WHERE id = $1 AND empresa_id = $2 RETURNING *',
            [consumo_id, empresa_id, baixar]
        );

        return atualizadas[0];
    });
}

// Consumo e custo por insumo e motivo, por competência (data do consumo). Soma o consumo das vendas (baixado e
// não devolvido) com o consumo avulso. A compra do insumo NÃO entra aqui (compra = caixa; consumo = custo).
async function relatorio({ empresa_id, de, ate, produto_id, motivo }) {
    const valores = [empresa_id];
    const condicoes = [...condicoesPeriodo({ de, ate, produto_id }, valores, 'm.produto_id', 'm.criado_em')];

    if (motivo !== undefined) {
        valores.push(motivo);
        condicoes.push(`m.motivo = $${valores.length}`);
    }

    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const { rows } = await db.query(
        `WITH mov AS (
            SELECT c.produto_id,
                   CASE c.origem WHEN 'ficha' THEN 'consumo_venda' ELSE c.origem END AS motivo,
                   c.quantidade_baixada AS quantidade, c.custo_unitario, c.criado_em
            FROM venda_consumos c
            WHERE c.empresa_id = $1 AND c.devolvido_em IS NULL AND c.quantidade_baixada > 0
            UNION ALL
            SELECT a.produto_id, a.motivo, a.quantidade, a.custo_unitario, a.criado_em
            FROM consumos_avulsos a
            WHERE a.empresa_id = $1
        )
        SELECT m.produto_id, p.sku, p.nome, m.motivo,
               SUM(m.quantidade)::int AS quantidade,
               ROUND(SUM(m.quantidade * m.custo_unitario), 2) AS custo_total
        FROM mov m
        JOIN produtos p ON p.id = m.produto_id AND p.empresa_id = $1
        ${where}
        GROUP BY m.produto_id, p.sku, p.nome, m.motivo
        ORDER BY p.nome, m.motivo`,
        valores
    );

    return rows;
}

module.exports = {
    listarInsumos,
    registrarAvulso,
    listarAvulsos,
    linhasDaVenda,
    acrescentarNaVenda,
    retirarLinha,
    regularizarLinha,
    relatorio
};
