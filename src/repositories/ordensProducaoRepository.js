const db = require('../config/db');
const estoqueRepository = require('./estoqueRepository');
const { executarComLock } = require('./shared/transacoes');
const AppError = require('../errors/AppError');

// Ordem de produção (PCP, migration 122). Toda leitura e escrita leva empresa_id. Quem muda estoque usa
// transação única, trava a ordem e os insumos (FOR UPDATE, em ordem de id, para não gerar deadlock) e nunca
// deixa o estoque ficar negativo (estoqueRepository.criarMovimentacao recusa).

const SELECT_ORDEM = `
    SELECT o.*, p.nome AS produto_nome, p.sku AS produto_sku,
           to_char(o.prazo, 'YYYY-MM-DD') AS prazo_iso,
           (SELECT COUNT(*)::int FROM ordem_producao_consumos c
             WHERE c.ordem_id = o.id AND c.empresa_id = o.empresa_id
               AND c.quantidade_baixada < c.quantidade_prevista) AS insumos_pendentes
      FROM ordens_producao o
      JOIN produtos p ON p.id = o.produto_id AND p.empresa_id = o.empresa_id`;

// `prazo` é DATE: devolve YYYY-MM-DD puro (sem conversão por Date/UTC).
function normalizar(linha) {
    if (!linha) return linha;
    const { prazo_iso: prazoIso, ...resto } = linha;

    return { ...resto, prazo: prazoIso };
}

async function criar({ produto_id: produtoId, quantidade_planejada: quantidadePlanejada, prazo, observacao, usuario_id: usuarioId, empresa_id: empresaId }) {
    const { rows: produtos } = await db.query(
        'SELECT id, tipo, ativo FROM produtos WHERE id = $1 AND empresa_id = $2',
        [produtoId, empresaId]
    );

    if (!produtos.length) throw new AppError('Produto não encontrado', 404);
    if (produtos[0].tipo !== 'acabado') throw new AppError("Produto deve ser do tipo 'acabado' para ser produzido", 400);
    if (!produtos[0].ativo) throw new AppError('Produto inativo não pode ser produzido', 400);

    const { rows: fichas } = await db.query(
        'SELECT id FROM fichas_tecnicas WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
        [produtoId, empresaId]
    );

    if (!fichas.length) throw new AppError('Produto não possui ficha técnica cadastrada', 400);

    const { rows } = await db.query(
        `INSERT INTO ordens_producao (empresa_id, produto_id, ficha_tecnica_id, quantidade_planejada, prazo, observacao, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [empresaId, produtoId, fichas[0].id, quantidadePlanejada, prazo ?? null, observacao ?? null, usuarioId]
    );

    return buscarPorId(rows[0].id, empresaId);
}

async function listarPaginado({ status, produto_id: produtoId, limit, offset, empresa_id: empresaId }) {
    const condicoes = ['o.empresa_id = $1'];
    const valores = [empresaId];

    if (status !== undefined) {
        valores.push(status);
        condicoes.push(`o.status = $${valores.length}`);
    }

    if (produtoId !== undefined) {
        valores.push(produtoId);
        condicoes.push(`o.produto_id = $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;
    const { rows } = await db.query(
        `${SELECT_ORDEM}
         ${where}
         ORDER BY o.criado_em DESC, o.id DESC
         LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limit, offset]
    );
    const { rows: contagem } = await db.query(`SELECT COUNT(*)::int AS total FROM ordens_producao o ${where}`, valores);

    return { items: rows.map(normalizar), total: contagem[0].total };
}

// Ordem com os insumos da ficha congelada: consumo por unidade, saldo atual e custo atual de cada um.
async function buscarPorId(id, empresaId) {
    const { rows } = await db.query(`${SELECT_ORDEM} WHERE o.id = $1 AND o.empresa_id = $2`, [id, empresaId]);

    if (!rows.length) return null;

    const { rows: insumos } = await db.query(
        `SELECT i.insumo_produto_id, p.sku, p.nome, p.ativo, p.estoque_atual, p.custo,
                i.quantidade_necessaria AS por_unidade
           FROM itens_ficha_tecnica i
           JOIN produtos p ON p.id = i.insumo_produto_id AND p.empresa_id = i.empresa_id
          WHERE i.ficha_tecnica_id = $1 AND i.empresa_id = $2
          ORDER BY i.id`,
        [rows[0].ficha_tecnica_id, empresaId]
    );

    const { rows: consumos } = await db.query(
        `SELECT c.insumo_produto_id, p.sku, p.nome, c.quantidade_prevista, c.quantidade_baixada, c.custo_unitario
           FROM ordem_producao_consumos c
           JOIN produtos p ON p.id = c.insumo_produto_id AND p.empresa_id = c.empresa_id
          WHERE c.ordem_id = $1 AND c.empresa_id = $2
          ORDER BY c.insumo_produto_id`,
        [id, empresaId]
    );

    return { ...normalizar(rows[0]), insumos, consumos };
}

async function iniciar(id, usuarioId, empresaId) {
    await executarComLock('ordens_producao', { coluna: 'id', valor: id }, empresaId, undefined, async (ordem, client) => {
        if (!ordem) throw new AppError('Ordem de produção não encontrada', 404);
        if (ordem.status !== 'planejada') throw new AppError('Somente ordens planejadas podem ser iniciadas', 409);

        await client.query(
            `UPDATE ordens_producao
                SET status = 'em_producao', iniciada_por = $3, iniciada_em = NOW(), atualizado_em = NOW()
              WHERE id = $1 AND empresa_id = $2`,
            [id, empresaId, usuarioId]
        );
    });

    return buscarPorId(id, empresaId);
}

// Conclui: baixa cada insumo em min(necessário, saldo do Central) e dá entrada no acabado com a produzida. O que
// faltar de insumo vira PENDÊNCIA (ordem_producao_consumos), baixada depois por `regularizarInsumos`: faltar insumo
// no sistema não trava a produção (ele pode existir fisicamente e só não ter dado entrada). Estoque nunca fica negativo.
// Tudo na mesma transação.
async function concluir(id, { quantidade_produzida: produzida, quantidade_perdida: perdida }, usuarioId, empresaId) {
    await executarComLock('ordens_producao', { coluna: 'id', valor: id }, empresaId, undefined, async (ordem, client) => {
        if (!ordem) throw new AppError('Ordem de produção não encontrada', 404);
        if (ordem.status !== 'em_producao') throw new AppError('Somente ordens em produção podem ser concluídas', 409);

        const { rows: itens } = await client.query(
            `SELECT i.insumo_produto_id, i.quantidade_necessaria AS por_unidade
               FROM itens_ficha_tecnica i
              WHERE i.ficha_tecnica_id = $1 AND i.empresa_id = $2
              ORDER BY i.insumo_produto_id`,
            [ordem.ficha_tecnica_id, empresaId]
        );

        // Trava os insumos em ordem de id (evita deadlock entre conclusões simultâneas) e lê custo e situação.
        const { rows: insumos } = await client.query(
            `SELECT id, ativo, custo FROM produtos
              WHERE id = ANY($1::int[]) AND empresa_id = $2
              ORDER BY id
                FOR UPDATE`,
            [itens.map((i) => i.insumo_produto_id), empresaId]
        );
        const porId = new Map(insumos.map((p) => [p.id, p]));
        const consumidas = produzida + perdida;
        const centralId = await estoqueRepository.garantirLocalCentral(client, empresaId);
        let custoInsumos = 0;

        for (const item of itens) {
            const insumo = porId.get(item.insumo_produto_id);

            if (!insumo?.ativo) throw new AppError('Produto inativo não pode receber movimentações de estoque', 400);

            const previsto = Number(item.por_unidade) * consumidas;
            const { rows: saldoRows } = await client.query(
                'SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2 AND empresa_id = $3',
                [item.insumo_produto_id, centralId, empresaId]
            );
            const baixar = Math.min(previsto, Math.max(saldoRows.length ? saldoRows[0].saldo : 0, 0));

            if (baixar > 0) {
                const resultado = await estoqueRepository.criarMovimentacao(
                    {
                        produto_id: item.insumo_produto_id,
                        tipo: 'saida',
                        quantidade: baixar,
                        motivo: `Ordem de produção #${id}`,
                        usuario_id: usuarioId,
                        empresa_id: empresaId,
                        local_id: centralId
                    },
                    client
                );

                if (resultado.erro === 'PRODUTO_NAO_ENCONTRADO') throw new AppError('Produto não encontrado', 404);
                if (resultado.erro) throw new AppError('Não foi possível baixar o insumo', 409);
            }

            await client.query(
                `INSERT INTO ordem_producao_consumos (empresa_id, ordem_id, insumo_produto_id, local_id, quantidade_prevista, quantidade_baixada, custo_unitario)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [empresaId, id, item.insumo_produto_id, centralId, previsto, baixar, insumo.custo]
            );

            // Custo real = necessidade COMPLETA (inclui o que ainda não foi baixado).
            custoInsumos += previsto * Number(insumo.custo);
        }

        if (produzida > 0) {
            const entrada = await estoqueRepository.criarMovimentacao(
                {
                    produto_id: ordem.produto_id,
                    tipo: 'entrada',
                    quantidade: produzida,
                    motivo: `Ordem de produção #${id}`,
                    usuario_id: usuarioId,
                    empresa_id: empresaId
                },
                client
            );

            if (entrada.erro === 'PRODUTO_NAO_ENCONTRADO') throw new AppError('Produto não encontrado', 404);
        }

        await client.query(
            `UPDATE ordens_producao
                SET status = 'concluida', quantidade_produzida = $3, quantidade_perdida = $4, custo_insumos = $5,
                    concluida_por = $6, concluida_em = NOW(), atualizado_em = NOW()
              WHERE id = $1 AND empresa_id = $2`,
            [id, empresaId, produzida, perdida, Math.round((custoInsumos + Number.EPSILON) * 100) / 100, usuarioId]
        );
    });

    return buscarPorId(id, empresaId);
}

// Regulariza a pendência de uma ordem concluída: baixa de cada insumo o que o Central tem (até o pendente).
// Chamada depois que o insumo deu entrada no sistema. Sem pendência = 409; nenhum insumo com saldo = 409.
async function regularizarInsumos(id, usuarioId, empresaId) {
    await executarComLock('ordens_producao', { coluna: 'id', valor: id }, empresaId, undefined, async (ordem, client) => {
        if (!ordem) throw new AppError('Ordem de produção não encontrada', 404);
        if (ordem.status !== 'concluida') throw new AppError('Somente ordens concluídas têm insumos a regularizar', 409);

        const { rows: linhas } = await client.query(
            `SELECT * FROM ordem_producao_consumos
              WHERE ordem_id = $1 AND empresa_id = $2 AND quantidade_baixada < quantidade_prevista
              ORDER BY insumo_produto_id
                FOR UPDATE`,
            [id, empresaId]
        );

        if (!linhas.length) throw new AppError('Esta ordem não tem insumo pendente', 409);

        // Trava os insumos antes de ler o saldo (mesma ordem de toda movimentação: ordem -> produto -> saldo).
        await client.query(
            'SELECT id FROM produtos WHERE id = ANY($1::int[]) AND empresa_id = $2 ORDER BY id FOR UPDATE',
            [linhas.map((l) => l.insumo_produto_id), empresaId]
        );

        let baixouAlgo = false;

        for (const linha of linhas) {
            const { rows: saldoRows } = await client.query(
                'SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2 AND empresa_id = $3',
                [linha.insumo_produto_id, linha.local_id, empresaId]
            );
            const pendente = linha.quantidade_prevista - linha.quantidade_baixada;
            const baixar = Math.min(pendente, Math.max(saldoRows.length ? saldoRows[0].saldo : 0, 0));

            if (baixar <= 0) continue;

            const resultado = await estoqueRepository.criarMovimentacao(
                {
                    produto_id: linha.insumo_produto_id,
                    tipo: 'saida',
                    quantidade: baixar,
                    motivo: `Regularização ordem de produção #${id}`,
                    usuario_id: usuarioId,
                    empresa_id: empresaId,
                    local_id: linha.local_id
                },
                client
            );

            if (resultado.erro) throw new AppError('Não foi possível baixar o insumo', 409);

            await client.query(
                'UPDATE ordem_producao_consumos SET quantidade_baixada = quantidade_baixada + $3, atualizado_em = NOW() WHERE id = $1 AND empresa_id = $2',
                [linha.id, empresaId, baixar]
            );
            baixouAlgo = true;
        }

        if (!baixouAlgo) throw new AppError('Sem saldo dos insumos no Central para regularizar. Dê entrada no estoque primeiro.', 409);
    });

    return buscarPorId(id, empresaId);
}

// Cancela ordem planejada ou em produção (nada foi consumido). Concluída não cancela.
async function cancelar(id, { motivo }, usuarioId, empresaId) {
    await executarComLock('ordens_producao', { coluna: 'id', valor: id }, empresaId, undefined, async (ordem, client) => {
        if (!ordem) throw new AppError('Ordem de produção não encontrada', 404);
        if (!['planejada', 'em_producao'].includes(ordem.status)) {
            throw new AppError('Somente ordens planejadas ou em produção podem ser canceladas', 409);
        }

        await client.query(
            `UPDATE ordens_producao
                SET status = 'cancelada', motivo_cancelamento = $3, cancelada_por = $4, cancelada_em = NOW(), atualizado_em = NOW()
              WHERE id = $1 AND empresa_id = $2`,
            [id, empresaId, motivo, usuarioId]
        );
    });

    return buscarPorId(id, empresaId);
}

module.exports = { criar, listarPaginado, buscarPorId, iniciar, concluir, regularizarInsumos, cancelar };
