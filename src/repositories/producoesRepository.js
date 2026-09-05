const db = require('../config/db');
const estoqueRepository = require('./estoqueRepository');
const { executarComLock } = require('./shared/transacoes');
const AppError = require('../errors/AppError');

// Uma única transação: valida produto (tipo 'acabado', ativo) e a existência
// de uma ficha técnica vigente pra ele; trava (FOR UPDATE) o estoque de cada
// insumo envolvido numa única query antes de decidir quanto dá pra produzir
// — precisa ser uma leitura travada separada de estoqueRepository.
// criarMovimentacao porque a decisão (quantidade_produzida) tem que ser
// tomada ANTES de qualquer baixa de estoque acontecer, e criarMovimentacao já
// escreve a baixa no mesmo passo em que lê. Cada insumo limita
// quantidade_produzida a floor(estoque_atual / quantidade_necessaria); o
// mínimo entre todos os insumos e quantidade_solicitada vence. 0 producido
// bloqueia com 409 e não cria nada (nem a linha producoes, nem movimentação
// nenhuma) — só dali em diante é que estoqueRepository.criarMovimentacao
// entra pra realmente gravar saída dos insumos e entrada do acabado.
async function criar({ produto_id, quantidade_solicitada, usuario_id, empresa_id }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows: produtoRows } = await client.query(
            'SELECT id, tipo, ativo FROM produtos WHERE id = $1 AND empresa_id = $2',
            [produto_id, empresa_id]
        );

        if (!produtoRows.length) {
            throw new AppError('Produto não encontrado', 404);
        }

        if (produtoRows[0].tipo !== 'acabado') {
            throw new AppError("Produto deve ser do tipo 'acabado' para ser produzido", 400);
        }

        if (!produtoRows[0].ativo) {
            throw new AppError('Produto inativo não pode receber movimentações de estoque', 400);
        }

        const { rows: fichaRows } = await client.query(
            'SELECT id FROM fichas_tecnicas WHERE produto_id = $1 AND empresa_id = $2 AND vigente = true',
            [produto_id, empresa_id]
        );

        if (!fichaRows.length) {
            throw new AppError('Produto não possui ficha técnica cadastrada', 400);
        }

        const ficha_tecnica_id = fichaRows[0].id;

        const { rows: itensFicha } = await client.query(
            'SELECT insumo_produto_id, quantidade_necessaria FROM itens_ficha_tecnica WHERE ficha_tecnica_id = $1 ORDER BY id',
            [ficha_tecnica_id]
        );

        const insumoIds = itensFicha.map((item) => item.insumo_produto_id);

        const { rows: estoqueRows } = await client.query(
            'SELECT id, estoque_atual FROM produtos WHERE id = ANY($1::int[]) AND empresa_id = $2 FOR UPDATE',
            [insumoIds, empresa_id]
        );

        const estoquePorInsumo = new Map(estoqueRows.map((row) => [row.id, row.estoque_atual]));

        let quantidade_produzida = quantidade_solicitada;

        for (const item of itensFicha) {
            const estoqueAtual = estoquePorInsumo.get(item.insumo_produto_id) ?? 0;
            const possivel = Math.floor(estoqueAtual / item.quantidade_necessaria);
            quantidade_produzida = Math.min(quantidade_produzida, possivel);
        }

        quantidade_produzida = Math.max(0, quantidade_produzida);

        if (quantidade_produzida === 0) {
            throw new AppError('Estoque insuficiente para produzir ao menos uma unidade', 409);
        }

        const { rows: producaoRows } = await client.query(
            `INSERT INTO producoes (empresa_id, produto_id, ficha_tecnica_id, quantidade_solicitada, quantidade_produzida, status, usuario_id)
             VALUES ($1, $2, $3, $4, $5, 'concluida', $6)
             RETURNING *`,
            [empresa_id, produto_id, ficha_tecnica_id, quantidade_solicitada, quantidade_produzida, usuario_id]
        );

        const producao = producaoRows[0];

        for (const item of itensFicha) {
            await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.insumo_produto_id,
                    tipo: 'saida',
                    quantidade: item.quantidade_necessaria * quantidade_produzida,
                    motivo: `Produção #${producao.id}`,
                    usuario_id,
                    empresa_id
                },
                client
            );
        }

        await estoqueRepository.criarMovimentacao(
            {
                produto_id,
                tipo: 'entrada',
                quantidade: quantidade_produzida,
                motivo: `Produção #${producao.id}`,
                usuario_id,
                empresa_id
            },
            client
        );

        await client.query('COMMIT');

        return { ...producao, parcial: quantidade_produzida < quantidade_solicitada };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listarPaginado({ limit, offset, produto_id, dataDe, dataAte, empresa_id }) {
    const condicoes = ['pr.empresa_id = $1'];
    const valores = [empresa_id];

    if (produto_id !== undefined) {
        valores.push(produto_id);
        condicoes.push(`pr.produto_id = $${valores.length}`);
    }

    if (dataDe !== undefined) {
        valores.push(dataDe);
        condicoes.push(`pr.criado_em::date >= $${valores.length}`);
    }

    if (dataAte !== undefined) {
        valores.push(dataAte);
        condicoes.push(`pr.criado_em::date <= $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;

    const valoresListagem = [...valores, limit, offset];
    const { rows } = await db.query(
        `SELECT pr.*, p.nome AS produto_nome
         FROM producoes pr
         JOIN produtos p ON p.id = pr.produto_id
         ${where}
         ORDER BY pr.criado_em DESC, pr.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM producoes pr ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT pr.*, p.nome AS produto_nome, p.sku AS produto_sku
         FROM producoes pr
         JOIN produtos p ON p.id = pr.produto_id
         WHERE pr.id = $1 AND pr.empresa_id = $2`,
        [id, empresa_id]
    );

    if (!rows.length) return null;

    const producao = rows[0];

    const { rows: itensRows } = await db.query(
        `SELECT itf.insumo_produto_id, itf.quantidade_necessaria, p.nome AS insumo_nome, p.custo AS custo_unitario
         FROM itens_ficha_tecnica itf
         JOIN produtos p ON p.id = itf.insumo_produto_id
         WHERE itf.ficha_tecnica_id = $1
         ORDER BY itf.id`,
        [producao.ficha_tecnica_id]
    );

    let custo_total = 0;

    const itens = itensRows.map((item) => {
        const quantidade_consumida = item.quantidade_necessaria * producao.quantidade_produzida;
        const custo_unitario = Number(item.custo_unitario);
        const subtotal_custo = Number((quantidade_consumida * custo_unitario).toFixed(2));
        custo_total += subtotal_custo;

        return {
            insumo_produto_id: item.insumo_produto_id,
            insumo_nome: item.insumo_nome,
            quantidade_necessaria: item.quantidade_necessaria,
            quantidade_consumida,
            custo_unitario,
            subtotal_custo
        };
    });

    return { ...producao, itens, custo_total: Number(custo_total.toFixed(2)) };
}

// Estorna: saída do acabado primeiro (se não houver estoque suficiente —
// ex: já foi vendido — bloqueia 409 SEM tocar nos insumos, mesma regra de
// estoque negativo que já existe em estoqueRepository.criarMovimentacao),
// depois entrada de volta em cada insumo (proporcional a
// quantidade_produzida, não quantidade_solicitada — é o que de fato saiu do
// estoque). Usa executarComLock direto (não transicionarStatus) porque há
// efeitos colaterais entre o lock e a escrita final, mesmo padrão de
// vendasRepository.cancelar.
async function cancelar(id, usuario_id, empresa_id) {
    return executarComLock('producoes', { coluna: 'id', valor: id }, empresa_id, undefined, async (producao, client) => {
        if (!producao) {
            throw new AppError('Produção não encontrada', 404);
        }

        if (producao.status !== 'concluida') {
            throw new AppError('Somente produções concluídas podem ser canceladas', 409);
        }

        const resultadoAcabado = await estoqueRepository.criarMovimentacao(
            {
                produto_id: producao.produto_id,
                tipo: 'saida',
                quantidade: producao.quantidade_produzida,
                motivo: `Cancelamento produção #${producao.id}`,
                usuario_id,
                empresa_id
            },
            client
        );

        if (resultadoAcabado.erro === 'PRODUTO_NAO_ENCONTRADO') {
            throw new AppError('Produto não encontrado', 404);
        }

        if (resultadoAcabado.erro === 'ESTOQUE_INSUFICIENTE') {
            throw new AppError('Estoque insuficiente para estornar esta produção', 409);
        }

        const { rows: itensRows } = await client.query(
            'SELECT insumo_produto_id, quantidade_necessaria FROM itens_ficha_tecnica WHERE ficha_tecnica_id = $1',
            [producao.ficha_tecnica_id]
        );

        for (const item of itensRows) {
            await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.insumo_produto_id,
                    tipo: 'entrada',
                    quantidade: item.quantidade_necessaria * producao.quantidade_produzida,
                    motivo: `Cancelamento produção #${producao.id}`,
                    usuario_id,
                    empresa_id
                },
                client
            );
        }

        const { rows: atualizadaRows } = await client.query(
            `UPDATE producoes SET status = 'cancelada', atualizado_em = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );

        return atualizadaRows[0];
    });
}

module.exports = {
    criar,
    listarPaginado,
    buscarPorId,
    cancelar
};
