const db = require('../config/db');

const CAMPOS = ['historia', 'fundadora_nome', 'servicos', 'atendimento', 'horario_atendimento', 'email_contato', 'whatsapp',
    'instagram_url', 'facebook_url', 'tiktok_url', 'razao_social', 'cnpj', 'endereco', 'avisos'];

const VAZIO = Object.freeze(Object.fromEntries(CAMPOS.map((c) => [c, null])));

async function buscar(empresa_id) {
    const { rows } = await db.query(
        `SELECT ${CAMPOS.join(', ')}, atualizado_em FROM loja_institucional WHERE empresa_id = $1`,
        [empresa_id]
    );

    return rows[0] ? { ...rows[0] } : { ...VAZIO, atualizado_em: null };
}

// Grava só os campos enviados (os ausentes ficam como estão; `null` limpa). Sob lock da linha da empresa.
async function salvar(empresa_id, usuario_id, dados) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        // Garante a linha (vazia) e a trava; depois mescla.
        await client.query('INSERT INTO loja_institucional (empresa_id) VALUES ($1) ON CONFLICT (empresa_id) DO NOTHING', [empresa_id]);
        const { rows } = await client.query(`SELECT ${CAMPOS.join(', ')} FROM loja_institucional WHERE empresa_id = $1 FOR UPDATE`, [empresa_id]);
        const final = { ...rows[0], ...Object.fromEntries(CAMPOS.filter((c) => c in dados).map((c) => [c, dados[c]])) };

        await client.query(
            `UPDATE loja_institucional SET ${CAMPOS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, atualizado_por = $2, atualizado_em = NOW()
              WHERE empresa_id = $1`,
            [empresa_id, usuario_id, ...CAMPOS.map((c) => final[c])]
        );
        await client.query('COMMIT');
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        client.release();
    }

    return buscar(empresa_id);
}

module.exports = { buscar, salvar, CAMPOS };
