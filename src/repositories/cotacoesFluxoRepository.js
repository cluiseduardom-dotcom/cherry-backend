const db = require('../config/db');
const AppError = require('../errors/AppError');
const base = require('./cotacoesRepository');
const pedidosFluxo = require('./pedidosCompraFluxoRepository');
const { executarComLock } = require('./shared/transacoes');
const { somarDias } = require('../utils/dataSaoPaulo');

// Cotação (compras avançado): pedir preço a vários fornecedores, registrar as propostas e gerar o(s) pedido(s) de compra do vencedor
// de cada item. A cotação nasce ABERTA (não há etapa de rascunho) e termina ENCERRADA (pedidos gerados) ou CANCELADA.

const ABERTAS = ['ABERTA', 'EM_ANALISE'];

async function proximoNumero(client, empresa_id, ano) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`cotacao-numero:${empresa_id}`]);

    const prefixo = `COT-${ano}-`;
    const { rows } = await client.query(
        `SELECT COALESCE(MAX(SUBSTRING(numero FROM '^COT-[0-9]{4}-([0-9]+)$')::int), 0) + 1 AS proximo
         FROM cotacoes WHERE empresa_id = $1 AND numero LIKE $2`,
        [empresa_id, `${prefixo}%`]
    );

    return `${prefixo}${String(rows[0].proximo).padStart(4, '0')}`;
}

async function criarComItens({ data_limite, observacoes }, itens, fornecedorIds, { empresa_id, usuario_id, ano, hoje }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const numero = await proximoNumero(client, empresa_id, ano);
        const { rows } = await client.query(
            `INSERT INTO cotacoes (empresa_id, numero, solicitante_id, comprador_id, data_abertura, data_limite, status, observacoes)
             VALUES ($1, $2, $3, $3, $4, $5, 'ABERTA', $6) RETURNING id`,
            [empresa_id, numero, usuario_id, hoje, data_limite ?? null, observacoes ?? null]
        );
        const id = rows[0].id;

        for (const item of itens) await base.adicionarItem({ ...item, empresa_id, cotacao_id: id }, client);
        for (const fornecedor_id of fornecedorIds) await base.adicionarFornecedor({ empresa_id, cotacao_id: id, fornecedor_id }, client);

        await client.query('COMMIT');

        return id;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function detalhar(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT c.*, to_char(c.data_abertura, 'YYYY-MM-DD') AS data_abertura, to_char(c.data_limite, 'YYYY-MM-DD') AS data_limite
         FROM cotacoes c WHERE c.id = $1 AND c.empresa_id = $2`,
        [id, empresa_id]
    );

    if (!rows.length) return null;

    const [itens, fornecedores, ofertas] = await Promise.all([
        db.query(
            `SELECT i.*, p.nome AS produto_nome FROM cotacoes_itens i
             LEFT JOIN produtos p ON p.id = i.produto_id AND p.empresa_id = i.empresa_id
             WHERE i.cotacao_id = $1 AND i.empresa_id = $2 ORDER BY i.id`,
            [id, empresa_id]
        ),
        db.query(
            `SELECT cf.*, f.nome AS fornecedor_nome FROM cotacoes_fornecedores cf
             JOIN fornecedores f ON f.id = cf.fornecedor_id AND f.empresa_id = cf.empresa_id
             WHERE cf.cotacao_id = $1 AND cf.empresa_id = $2 ORDER BY cf.id`,
            [id, empresa_id]
        ),
        db.query(
            `SELECT o.*, cf.fornecedor_id FROM cotacoes_fornecedores_itens o
             JOIN cotacoes_fornecedores cf ON cf.id = o.cotacao_fornecedor_id AND cf.empresa_id = o.empresa_id
             WHERE cf.cotacao_id = $1 AND o.empresa_id = $2 ORDER BY o.id`,
            [id, empresa_id]
        )
    ]);

    return { cotacao: rows[0], itens: itens.rows, fornecedores: fornecedores.rows, ofertas: ofertas.rows };
}

async function listarPaginado({ empresa_id, status, page, pageSize }) {
    const valores = [empresa_id];
    let where = 'c.empresa_id = $1';

    if (status) {
        valores.push(status);
        where += ` AND c.status = $${valores.length}`;
    }

    const { rows: [{ total }] } = await db.query(`SELECT COUNT(*)::int AS total FROM cotacoes c WHERE ${where}`, valores);

    valores.push(pageSize, (page - 1) * pageSize);
    const { rows } = await db.query(
        `SELECT c.id, c.numero, c.status, to_char(c.data_abertura, 'YYYY-MM-DD') AS data_abertura, to_char(c.data_limite, 'YYYY-MM-DD') AS data_limite,
                (SELECT COUNT(*)::int FROM cotacoes_itens i WHERE i.cotacao_id = c.id AND i.empresa_id = c.empresa_id) AS itens,
                (SELECT COUNT(*)::int FROM cotacoes_fornecedores f WHERE f.cotacao_id = c.id AND f.empresa_id = c.empresa_id) AS fornecedores,
                (SELECT COUNT(*)::int FROM cotacoes_fornecedores f WHERE f.cotacao_id = c.id AND f.empresa_id = c.empresa_id AND f.status = 'RESPONDIDA') AS respondidas
         FROM cotacoes c WHERE ${where}
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
        valores
    );

    return { rows, total };
}

const travar = (id, empresa_id, callback) => executarComLock('cotacoes', { coluna: 'id', valor: id }, empresa_id, null, async (cotacao, client) => {
    if (!cotacao) throw new AppError('Cotação não encontrada', 404);

    return callback(cotacao, client);
});

function exigirAberta(cotacao) {
    if (!ABERTAS.includes(cotacao.status)) {
        throw new AppError(cotacao.status === 'ENCERRADA' ? 'Cotação já encerrada' : `Cotação não está aberta (${cotacao.status})`, 409);
    }
}

async function fornecedorDaCotacao(client, cotacao, fornecedor_id) {
    const { rows } = await client.query(
        'SELECT * FROM cotacoes_fornecedores WHERE cotacao_id = $1 AND empresa_id = $2 AND fornecedor_id = $3',
        [cotacao.id, cotacao.empresa_id, fornecedor_id]
    );

    if (!rows.length) throw new AppError('Fornecedor não participa desta cotação', 404);

    return rows[0];
}

// Troca a proposta inteira do fornecedor (itens que ele cotou). Quantidade ofertada padrão = a solicitada.
async function registrarOferta(id, empresa_id, fornecedor_id, ofertas) {
    return travar(id, empresa_id, async (cotacao, client) => {
        exigirAberta(cotacao);
        const cf = await fornecedorDaCotacao(client, cotacao, fornecedor_id);
        const { rows: itens } = await client.query('SELECT id, quantidade_solicitada FROM cotacoes_itens WHERE cotacao_id = $1 AND empresa_id = $2', [id, empresa_id]);
        const solicitada = new Map(itens.map((i) => [String(i.id), Number(i.quantidade_solicitada)]));

        for (const o of ofertas) {
            if (!solicitada.has(String(o.cotacao_item_id))) throw new AppError('Item não pertence a esta cotação', 404);
            if (o.quantidade_ofertada === undefined) continue;
            if (o.quantidade_ofertada > solicitada.get(String(o.cotacao_item_id))) throw new AppError('Quantidade ofertada maior que a solicitada', 400);
        }

        await client.query('DELETE FROM cotacoes_fornecedores_itens WHERE cotacao_fornecedor_id = $1 AND empresa_id = $2', [cf.id, empresa_id]);
        for (const o of ofertas) {
            await base.adicionarOferta({
                ...o, empresa_id, cotacao_fornecedor_id: cf.id,
                quantidade_ofertada: o.quantidade_ofertada ?? solicitada.get(String(o.cotacao_item_id))
            }, client);
        }
        await client.query(`UPDATE cotacoes_fornecedores SET status = 'RESPONDIDA', data_resposta = NOW(), updated_at = NOW() WHERE id = $1 AND empresa_id = $2`, [cf.id, empresa_id]);

        return id;
    });
}

async function recusarFornecedor(id, empresa_id, fornecedor_id) {
    return travar(id, empresa_id, async (cotacao, client) => {
        exigirAberta(cotacao);
        const cf = await fornecedorDaCotacao(client, cotacao, fornecedor_id);

        await client.query('DELETE FROM cotacoes_fornecedores_itens WHERE cotacao_fornecedor_id = $1 AND empresa_id = $2', [cf.id, empresa_id]);
        await client.query(`UPDATE cotacoes_fornecedores SET status = 'RECUSADA', data_resposta = NOW(), updated_at = NOW() WHERE id = $1 AND empresa_id = $2`, [cf.id, empresa_id]);

        return id;
    });
}

async function cancelar(id, empresa_id) {
    return travar(id, empresa_id, async (cotacao, client) => {
        exigirAberta(cotacao);
        await client.query(`UPDATE cotacoes SET status = 'CANCELADA', updated_at = NOW() WHERE id = $1 AND empresa_id = $2`, [id, empresa_id]);

        return id;
    });
}

// Gera um pedido de compra (rascunho) por fornecedor escolhido, com os itens e preços da proposta dele, e encerra a cotação. Tudo numa
// transação: duas chamadas ao mesmo tempo, só uma gera (a outra recebe 409 "já encerrada").
async function gerarPedidos(id, empresa_id, escolhas, { usuario_id, ano, hoje }) {
    return travar(id, empresa_id, async (cotacao, client) => {
        exigirAberta(cotacao);

        const { rows: itens } = await client.query('SELECT * FROM cotacoes_itens WHERE cotacao_id = $1 AND empresa_id = $2', [id, empresa_id]);
        const porItem = new Map(itens.map((i) => [String(i.id), i]));
        const { rows: ofertas } = await client.query(
            `SELECT o.*, cf.fornecedor_id FROM cotacoes_fornecedores_itens o
             JOIN cotacoes_fornecedores cf ON cf.id = o.cotacao_fornecedor_id AND cf.empresa_id = o.empresa_id
             WHERE cf.cotacao_id = $1 AND o.empresa_id = $2`,
            [id, empresa_id]
        );
        const grupos = new Map();

        for (const escolha of escolhas) {
            const item = porItem.get(String(escolha.cotacao_item_id));

            if (!item) throw new AppError('Item não pertence a esta cotação', 404);

            const oferta = ofertas.find((o) => String(o.cotacao_item_id) === String(item.id) && String(o.fornecedor_id) === String(escolha.fornecedor_id));

            if (!oferta) throw new AppError(`O fornecedor escolhido não cotou o item "${item.descricao_snapshot}"`, 400);

            const chave = String(escolha.fornecedor_id);

            if (!grupos.has(chave)) grupos.set(chave, []);
            grupos.get(chave).push({ item, oferta });
        }

        const pedidos = [];

        for (const [fornecedor_id, linhas] of grupos) {
            const { rows: produtos } = await client.query(
                'SELECT id, nome, ativo FROM produtos WHERE id = ANY($1::int[]) AND empresa_id = $2',
                [linhas.map((l) => l.item.produto_id), empresa_id]
            );
            const inativo = produtos.find((p) => p.ativo === false);

            if (inativo) throw new AppError(`Produto inativo: ${inativo.nome}`, 400);

            const prazos = linhas.map((l) => l.oferta.prazo_entrega_dias).filter((d) => d !== null && d !== undefined);
            const condicao = linhas.map((l) => l.oferta.condicao_pagamento).find(Boolean);
            const pedido = await pedidosFluxo.criarNoClient(client, {
                fornecedor_id, cotacao_id: id,
                data_prevista_entrega: prazos.length ? somarDias(hoje, Math.max(...prazos)) : null,
                condicao_pagamento: condicao ?? null,
                observacoes: `Gerado da cotação ${cotacao.numero}`
            }, linhas.map(({ item, oferta }) => ({
                produto_id: item.produto_id,
                descricao_snapshot: item.descricao_snapshot,
                quantidade: oferta.quantidade_ofertada,
                unidade: item.unidade,
                preco_unitario: oferta.preco_unitario,
                desconto: oferta.desconto
            })), { empresa_id, usuario_id, ano, hoje });

            pedidos.push({ id: pedido.id, numero: pedido.numero, fornecedor_id, total: pedido.total });
        }

        await client.query(`UPDATE cotacoes SET status = 'ENCERRADA', updated_at = NOW() WHERE id = $1 AND empresa_id = $2`, [id, empresa_id]);

        return pedidos;
    });
}

async function buscarFornecedores(ids, empresa_id) {
    const { rows } = await db.query('SELECT id, ativo FROM fornecedores WHERE id = ANY($1::int[]) AND empresa_id = $2', [ids, empresa_id]);

    return rows;
}

module.exports = { criarComItens, detalhar, listarPaginado, registrarOferta, recusarFornecedor, cancelar, gerarPedidos, buscarFornecedores };
