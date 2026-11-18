const db = require('../config/db');
const { executarComLock } = require('./shared/transacoes');

// Primitivas da confirmação da importação. TODAS recebem o `client` da transação aberta por `comImportacaoTravada`
// (a decisão de negócio fica no service) e filtram por empresa_id. Inserção em bloco, nunca linha a linha.

const BLOCO = 500;

function emBlocos(lista) {
    const blocos = [];
    for (let i = 0; i < lista.length; i += BLOCO) blocos.push(lista.slice(i, i + BLOCO));
    return blocos;
}

// A prévia vale uma vez só: o token é buscado pelo hash, na empresa do JWT. Não trava nada (a trava vem depois).
async function buscarPreviaPorToken(token_hash, empresa_id) {
    const { rows } = await db.query(
        `SELECT p.importacao_id, p.expira_em, p.expira_em < NOW() AS expirada
         FROM importacoes_previas p
         WHERE p.token_hash = $1 AND p.empresa_id = $2`,
        [token_hash, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

// Trava a linha da importação (serializa duas confirmações do mesmo token) e roda a callback na transação.
async function comImportacaoTravada(importacao_id, empresa_id, callback) {
    return executarComLock('importacoes', { coluna: 'id', valor: importacao_id }, empresa_id, null, callback);
}

// Consome a prévia (apaga) e devolve o conteúdo. Dentro da transação: se a gravação falhar, a prévia volta junto.
async function consumirPrevia(client, { importacao_id, token_hash, empresa_id }) {
    const { rows } = await client.query(
        `DELETE FROM importacoes_previas
         WHERE importacao_id = $1 AND token_hash = $2 AND empresa_id = $3 AND expira_em >= NOW()
         RETURNING dados`,
        [importacao_id, token_hash, empresa_id]
    );
    return rows.length ? rows[0].dados : null;
}

// Trava a empresa (serializa duas importações de estoque inicial de prévias diferentes) e lê a trava de saldo.
async function travarEmpresa(client, empresa_id) {
    const { rows } = await client.query(
        `SELECT estoque_inicial_lancado_em FROM empresas WHERE id = $1 FOR UPDATE`,
        [empresa_id]
    );
    return rows.length ? rows[0].estoque_inicial_lancado_em : null;
}

async function gravarTravaEstoqueInicial(client, empresa_id) {
    await client.query(`UPDATE empresas SET estoque_inicial_lancado_em = NOW() WHERE id = $1`, [empresa_id]);
}

async function buscarCategoriasPorIds(client, ids, empresa_id) {
    if (!ids.length) return [];
    const { rows } = await client.query(
        `SELECT * FROM categorias_produto WHERE id = ANY($1::int[]) AND empresa_id = $2 AND deletado_em IS NULL`,
        [ids, empresa_id]
    );
    return rows;
}

// Produto nasce com saldo 0 e SEM preço: o saldo entra depois, como movimentação auditada. Devolve { sku -> id }.
// Todo produto da importação tem SKU antes de chegar aqui (informado ou gerado), o que dá o vínculo linha -> id.
async function inserirProdutos(client, { empresa_id, importacao_id, produtos }) {
    const idPorSku = new Map();

    for (const bloco of emBlocos(produtos)) {
        const { rows } = await client.query(
            `INSERT INTO produtos (empresa_id, sku, nome, custo, preco_venda, estoque_atual, estoque_minimo, ativo, tipo, unidade, importacao_id)
             SELECT $1, t.sku, t.nome, t.custo, NULL, 0, 0, true, 'acabado', 'UN', $2
             FROM unnest($3::text[], $4::text[], $5::numeric[]) AS t(sku, nome, custo)
             RETURNING id, sku`,
            [empresa_id, importacao_id, bloco.map((p) => p.sku), bloco.map((p) => p.nome), bloco.map((p) => p.custo)]
        );
        for (const r of rows) idPorSku.set(r.sku, r.id);
    }

    return idPorSku;
}

async function vincularCategorias(client, { empresa_id, vinculos }) {
    for (const bloco of emBlocos(vinculos)) {
        await client.query(
            `INSERT INTO produtos_categorias (produto_id, categoria_id, empresa_id)
             SELECT t.produto_id, t.categoria_id, $1 FROM unnest($2::int[], $3::int[]) AS t(produto_id, categoria_id)`,
            [empresa_id, bloco.map((v) => v.produto_id), bloco.map((v) => v.categoria_id)]
        );
    }
}

async function registrarSkusGerados(client, { empresa_id, usuario_id, itens }) {
    for (const bloco of emBlocos(itens)) {
        await client.query(
            `INSERT INTO historico_sku (empresa_id, produto_id, sku, configuracao_id, usuario_id, acao, motivo)
             SELECT $1, t.produto_id, t.sku, t.configuracao_id, $2, 'gerado', 'SKU gerado automaticamente pela importação de lista'
             FROM unnest($3::int[], $4::text[], $5::int[]) AS t(produto_id, sku, configuracao_id)`,
            [empresa_id, usuario_id, bloco.map((i) => i.produto_id), bloco.map((i) => i.sku), bloco.map((i) => i.configuracao_id)]
        );
    }
}

// Código interno (Code 128) para quem entra com saldo: o curto (id com 6 dígitos) e, se já usado por outro produto
// da empresa, o longo. Mesma regra de produtosCodigosService.garantirCodigosParaEtiqueta, em bloco e na transação.
async function inserirCodigosInternos(client, { empresa_id, usuario_id, produto_ids, candidatos }) {
    let faltando = produto_ids;

    for (const gerar of candidatos) {
        if (!faltando.length) break;

        const { rows } = await client.query(
            `INSERT INTO produtos_codigos (empresa_id, produto_id, codigo, tipo, principal, descricao, criado_por)
             SELECT $1, t.produto_id, t.codigo, 'INTERNO', true, 'Código interno (etiqueta)', $2
             FROM unnest($3::int[], $4::text[]) AS t(produto_id, codigo)
             ON CONFLICT DO NOTHING
             RETURNING produto_id`,
            [empresa_id, usuario_id, faltando, faltando.map(gerar)]
        );

        const criados = new Set(rows.map((r) => r.produto_id));
        faltando = faltando.filter((id) => !criados.has(id));
    }

    return { criados: produto_ids.length - faltando.length, sem_codigo: faltando };
}

// Cliente da importação: responsável é quem confirma (JWT). Devolve { telefone -> id }.
async function inserirClientes(client, { empresa_id, importacao_id, usuario_id, clientes }) {
    const idPorTelefone = new Map();

    for (const bloco of emBlocos(clientes)) {
        const { rows } = await client.query(
            `INSERT INTO clientes (empresa_id, nome, telefone, data_nascimento, observacoes, criado_por, importacao_id)
             SELECT $1, t.nome, t.telefone, t.data_nascimento, t.observacoes, $2, $3
             FROM unnest($4::text[], $5::text[], $6::date[], $7::text[]) AS t(nome, telefone, data_nascimento, observacoes)
             RETURNING id, telefone`,
            [
                empresa_id, usuario_id, importacao_id,
                bloco.map((c) => c.nome), bloco.map((c) => c.telefone), bloco.map((c) => c.data_nascimento), bloco.map((c) => c.observacoes)
            ]
        );
        for (const r of rows) idPorTelefone.set(r.telefone, r.id);
    }

    return idPorTelefone;
}

async function marcarConfirmada(client, { importacao_id, empresa_id, usuario_id, relatorio }) {
    await client.query(
        `UPDATE importacoes
         SET status = 'confirmada', confirmada_em = NOW(), confirmada_por = $3, relatorio = $4::jsonb
         WHERE id = $1 AND empresa_id = $2`,
        [importacao_id, empresa_id, usuario_id, JSON.stringify(relatorio)]
    );
}

async function buscarRelatorio(importacao_id, empresa_id) {
    const { rows } = await db.query(
        `SELECT id, tipo, nome_arquivo, status, confirmada_em, relatorio
         FROM importacoes WHERE id = $1 AND empresa_id = $2`,
        [importacao_id, empresa_id]
    );
    return rows.length ? rows[0] : null;
}

module.exports = {
    buscarPreviaPorToken,
    comImportacaoTravada,
    consumirPrevia,
    travarEmpresa,
    gravarTravaEstoqueInicial,
    buscarCategoriasPorIds,
    inserirProdutos,
    vincularCategorias,
    registrarSkusGerados,
    inserirCodigosInternos,
    inserirClientes,
    marcarConfirmada,
    buscarRelatorio
};
