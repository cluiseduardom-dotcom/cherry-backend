const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');
const usuariosRepository = require('./usuariosRepository');

// Foto de perfil (uma por usuário). Filtra SEMPRE por empresa_id na própria query.

async function buscarChave(usuario_id, empresa_id) {
    const { rows } = await db.query(
        `SELECT chave FROM usuarios_fotos WHERE usuario_id = $1 AND empresa_id = $2`,
        [usuario_id, empresa_id]
    );

    return rows[0]?.chave ?? null;
}

// Grava (ou troca) a foto com a linha do usuário TRAVADA. `autorizar(alvo)` decide se o ator pode
// (a mesma hierarquia da edição de dados) e é reavaliado aqui, sob o lock. A trilha registra só o NOME
// do campo ('foto'), como nas demais edições. Devolve a chave anterior para o service apagar do bucket.
async function definir({ empresa_id, usuario_id, chave, content_type, tamanho_bytes, executado_por, autorizar }) {
    return executarComLock('usuarios', { coluna: 'id', valor: usuario_id }, empresa_id, undefined, async (linha, client) => {
        if (!linha) {
            throw new AppError('Usuário não encontrado', 404);
        }

        const alvo = await usuariosRepository.obterDetalhe(empresa_id, usuario_id, client);

        autorizar(alvo);

        const { rows: anterior } = await client.query(
            `SELECT chave FROM usuarios_fotos WHERE usuario_id = $1 AND empresa_id = $2`,
            [usuario_id, empresa_id]
        );

        await client.query(
            `INSERT INTO usuarios_fotos (usuario_id, empresa_id, chave, content_type, tamanho_bytes, atualizado_por)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (usuario_id) DO UPDATE SET
                chave = EXCLUDED.chave, content_type = EXCLUDED.content_type,
                tamanho_bytes = EXCLUDED.tamanho_bytes, atualizado_por = EXCLUDED.atualizado_por,
                atualizado_em = NOW()`,
            [usuario_id, empresa_id, chave, content_type, tamanho_bytes, executado_por]
        );

        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo, campos)
             VALUES ($1, 'editar', $2, $3, $4, NULL, ARRAY['foto'])`,
            [empresa_id, usuario_id, alvo.papel, executado_por]
        );

        return { chave_anterior: anterior[0]?.chave ?? null };
    });
}

// Remove a foto (idempotente: sem foto não há o que remover nem evento). Devolve a chave para o
// service apagar o objeto do bucket.
async function remover({ empresa_id, usuario_id, executado_por, autorizar }) {
    return executarComLock('usuarios', { coluna: 'id', valor: usuario_id }, empresa_id, undefined, async (linha, client) => {
        if (!linha) {
            throw new AppError('Usuário não encontrado', 404);
        }

        const alvo = await usuariosRepository.obterDetalhe(empresa_id, usuario_id, client);

        autorizar(alvo);

        const { rows } = await client.query(
            `DELETE FROM usuarios_fotos WHERE usuario_id = $1 AND empresa_id = $2 RETURNING chave`,
            [usuario_id, empresa_id]
        );

        if (rows.length === 0) {
            return { chave: null };
        }

        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo, campos)
             VALUES ($1, 'editar', $2, $3, $4, NULL, ARRAY['foto'])`,
            [empresa_id, usuario_id, alvo.papel, executado_por]
        );

        return { chave: rows[0].chave };
    });
}

module.exports = { buscarChave, definir, remover };
