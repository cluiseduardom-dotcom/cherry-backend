const db = require('../config/db');

// Contexto de validação da prévia. Cada função é UMA consulta da empresa do JWT (sem N+1).

async function buscarProdutosExistentes(empresa_id) {
    const { rows } = await db.query(
        `SELECT sku, nome, tipo FROM produtos WHERE empresa_id = $1`,
        [empresa_id]
    );
    return rows;
}

async function buscarCategoriasDeProduto(empresa_id) {
    const { rows } = await db.query(
        `SELECT id, nome, nivel FROM categorias_produto
         WHERE empresa_id = $1 AND escopo = 'produto' AND deletado_em IS NULL`,
        [empresa_id]
    );
    return rows;
}

async function buscarLocaisImportaveis(empresa_id) {
    const { rows } = await db.query(
        `SELECT id, nome, tipo FROM locais_estoque
         WHERE empresa_id = $1 AND ativo = true AND tipo IN ('central', 'maleta', 'consignado')`,
        [empresa_id]
    );
    return rows;
}

async function buscarTelefonesDeClientes(empresa_id) {
    const { rows } = await db.query(
        `SELECT telefone FROM clientes WHERE empresa_id = $1 AND telefone IS NOT NULL AND telefone <> ''`,
        [empresa_id]
    );
    return rows.map((r) => r.telefone);
}

async function buscarEstoqueInicialLancadoEm(empresa_id) {
    const { rows } = await db.query(
        `SELECT estoque_inicial_lancado_em FROM empresas WHERE id = $1`,
        [empresa_id]
    );
    return rows.length ? rows[0].estoque_inicial_lancado_em : null;
}

// Prévia vencida: o conteúdo (dados pessoais) é apagado e a trilha da importação fica marcada como expirada.
async function expirarPreviasVencidas(empresa_id) {
    await db.query(
        `WITH vencidas AS (
             DELETE FROM importacoes_previas WHERE empresa_id = $1 AND expira_em < NOW() RETURNING importacao_id
         )
         UPDATE importacoes SET status = 'expirada'
         WHERE empresa_id = $1 AND status = 'previa' AND id IN (SELECT importacao_id FROM vencidas)`,
        [empresa_id]
    );
}

// Trilha + prévia numa única instrução: ou as duas linhas existem, ou nenhuma. `previa` é null quando não há nada a confirmar.
async function registrarPrevia({ empresa_id, usuario_id, tipo, nome_arquivo, hash_sha256, local_padrao_id, totais, previa }) {
    const valores = [
        empresa_id, usuario_id, tipo, nome_arquivo, hash_sha256, local_padrao_id ?? null,
        totais.linhas, totais.a_criar, totais.ignoradas, totais.com_aviso, totais.com_erro
    ];

    if (!previa) {
        const { rows } = await db.query(
            `INSERT INTO importacoes (empresa_id, usuario_id, tipo, nome_arquivo, hash_sha256, local_padrao_id,
                                      total_linhas, total_a_criar, total_ignoradas, total_com_aviso, total_com_erro)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id, criada_em`,
            valores
        );
        return { ...rows[0], expira_em: null };
    }

    const { rows } = await db.query(
        `WITH imp AS (
             INSERT INTO importacoes (empresa_id, usuario_id, tipo, nome_arquivo, hash_sha256, local_padrao_id,
                                      total_linhas, total_a_criar, total_ignoradas, total_com_aviso, total_com_erro)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id, criada_em
         ), prev AS (
             INSERT INTO importacoes_previas (importacao_id, empresa_id, token_hash, dados, expira_em)
             SELECT id, $1, $12, $13::jsonb, NOW() + make_interval(mins => $14::int) FROM imp
             RETURNING expira_em
         )
         SELECT imp.id, imp.criada_em, prev.expira_em FROM imp, prev`,
        [...valores, previa.token_hash, JSON.stringify(previa.dados), previa.ttl_minutos]
    );
    return rows[0];
}

module.exports = {
    buscarProdutosExistentes,
    buscarCategoriasDeProduto,
    buscarLocaisImportaveis,
    buscarTelefonesDeClientes,
    buscarEstoqueInicialLancadoEm,
    expirarPreviasVencidas,
    registrarPrevia
};
