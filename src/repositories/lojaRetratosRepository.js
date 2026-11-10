const db = require('../config/db');
const AppError = require('../errors/AppError');

const COLUNAS = `r.id, r.chave, r.alt, r.nome, r.ordem, r.ativo, r.autorizacao_assinada, r.autorizado_em,
    r.criado_em, u.nome AS autorizado_por_nome`;

const BASE = `FROM loja_retratos r
    LEFT JOIN usuarios u ON u.id = r.autorizado_por AND u.empresa_id = r.empresa_id`;

// Lista de gestão (admin): todos os retratos não removidos da empresa.
async function listar(empresa_id) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS} ${BASE} WHERE r.empresa_id = $1 AND r.removido_em IS NULL ORDER BY r.ordem, r.id`,
        [empresa_id]
    );
    return rows;
}

// Público: só retrato ativo E com autorização registrada. Nada além do necessário para exibir.
async function listarPublicos(empresa_id) {
    const { rows } = await db.query(
        `SELECT r.chave, r.alt, r.nome FROM loja_retratos r
          WHERE r.empresa_id = $1 AND r.ativo = true AND r.autorizacao_assinada = true AND r.removido_em IS NULL
          ORDER BY r.ordem, r.id`,
        [empresa_id]
    );
    return rows;
}

async function inserir({ empresa_id, chave, content_type, tamanho_bytes, alt, nome, criado_por }) {
    const { rows } = await db.query(
        `INSERT INTO loja_retratos (empresa_id, chave, content_type, tamanho_bytes, alt, nome, criado_por, ordem)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 COALESCE((SELECT MAX(ordem) + 1 FROM loja_retratos WHERE empresa_id = $1 AND removido_em IS NULL), 0))
         RETURNING id`,
        [empresa_id, chave, content_type, tamanho_bytes, alt, nome, criado_por]
    );
    return rows[0].id;
}

async function buscar(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS} ${BASE} WHERE r.id = $1 AND r.empresa_id = $2 AND r.removido_em IS NULL`,
        [id, empresa_id]
    );
    return rows[0] ?? null;
}

// Atualiza sob lock da linha. `mudancas` já vem validado; a regra de autorização é aplicada aqui, na mesma transação.
async function atualizar(id, empresa_id, usuario_id, mudancas) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            'SELECT * FROM loja_retratos WHERE id = $1 AND empresa_id = $2 AND removido_em IS NULL FOR UPDATE',
            [id, empresa_id]
        );

        if (!rows.length) throw new AppError('Retrato não encontrado', 404);

        const atual = rows[0];
        const alt = 'alt' in mudancas ? mudancas.alt : atual.alt;
        const autorizado = 'autorizacao_assinada' in mudancas ? mudancas.autorizacao_assinada : atual.autorizacao_assinada;
        // Ativar exige autorização e descrição; tirar a autorização desativa o retrato na hora.
        if (mudancas.ativo === true && !autorizado) throw new AppError('Só é possível ativar o retrato depois de confirmar a autorização de uso de imagem', 409);

        let ativo = 'ativo' in mudancas ? mudancas.ativo : atual.ativo;

        if (!autorizado) ativo = false;

        if (ativo && !(alt && alt.trim())) throw new AppError('Descreva a foto (texto para leitor de tela) antes de ativar o retrato', 409);

        const novaAutorizacao = autorizado && !atual.autorizacao_assinada;

        await client.query(
            `UPDATE loja_retratos
                SET alt = $3, nome = $4, ordem = $5, ativo = $6, autorizacao_assinada = $7,
                    autorizado_por = CASE WHEN $8 THEN $9::int WHEN $7 THEN autorizado_por ELSE NULL END,
                    autorizado_em = CASE WHEN $8 THEN NOW() WHEN $7 THEN autorizado_em ELSE NULL END,
                    atualizado_em = NOW()
              WHERE id = $1 AND empresa_id = $2`,
            [id, empresa_id, alt, 'nome' in mudancas ? mudancas.nome : atual.nome, 'ordem' in mudancas ? mudancas.ordem : atual.ordem,
                ativo, autorizado, novaAutorizacao, usuario_id]
        );
        await client.query('COMMIT');
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        client.release();
    }

    return buscar(id, empresa_id);
}

// Remove: marca removido_em (a linha fica como trilha) e devolve a chave para o arquivo sair do armazenamento.
async function remover(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE loja_retratos SET removido_em = NOW(), ativo = false, atualizado_em = NOW()
          WHERE id = $1 AND empresa_id = $2 AND removido_em IS NULL RETURNING chave`,
        [id, empresa_id]
    );

    if (!rows.length) throw new AppError('Retrato não encontrado', 404);

    return rows[0].chave;
}

module.exports = { listar, listarPublicos, inserir, buscar, atualizar, remover };
