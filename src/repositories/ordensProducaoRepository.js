const db = require('../config/db');
const estoqueRepository = require('./estoqueRepository');
const { executarComLock } = require('./shared/transacoes');
const AppError = require('../errors/AppError');

// Ordem de produção (PCP, migration 122). Toda leitura e escrita leva empresa_id. Quem muda estoque usa
// transação única, trava a ordem e os insumos (FOR UPDATE, em ordem de id, para não gerar deadlock) e nunca
// deixa o estoque ficar negativo (estoqueRepository.criarMovimentacao recusa).

const SELECT_ORDEM = `
    SELECT o.*, p.nome AS produto_nome, p.sku AS produto_sku,
           to_char(o.prazo, 'YYYY-MM-DD') AS prazo_iso
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

    return { ...normalizar(rows[0]), insumos };
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

// Conclui: baixa os insumos de (produzida + perdida) × consumo por unidade e dá entrada no acabado só com a
// produzida. Tudo na mesma transação; sem estoque de algum insumo = 409 e nada é gravado.
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
        let custoInsumos = 0;

        for (const item of itens) {
            const insumo = porId.get(item.insumo_produto_id);

            if (!insumo?.ativo) throw new AppError('Produto inativo não pode receber movimentações de estoque', 400);

            const quantidade = Number(item.por_unidade) * consumidas;
            const resultado = await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.insumo_produto_id,
                    tipo: 'saida',
                    quantidade,
                    motivo: `Ordem de produção #${id}`,
                    usuario_id: usuarioId,
                    empresa_id: empresaId
                },
                client
            );

            if (resultado.erro === 'PRODUTO_NAO_ENCONTRADO') throw new AppError('Produto não encontrado', 404);
            if (resultado.erro === 'ESTOQUE_INSUFICIENTE') throw new AppError('Estoque de insumo insuficiente para concluir esta ordem', 409);

            custoInsumos += quantidade * Number(insumo.custo);
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

module.exports = { criar, listarPaginado, buscarPorId, iniciar, concluir, cancelar };
