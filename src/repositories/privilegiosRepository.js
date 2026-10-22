const db = require('../config/db');

// Toda consulta filtra por empresa_id (do token). As operações que escrevem recebem o `client`
// da transação aberta pelo serviço.

// Serializa concessões/revogações do mesmo comércio (evita duas revogações simultâneas
// deixarem a empresa sem Admin).
async function travarEmpresa(client, empresa_id) {
    await client.query('SELECT id FROM empresas WHERE id = $1 FOR UPDATE', [empresa_id]);
}

async function buscarSenhaHash(empresa_id, usuario_id) {
    const { rows } = await db.query(
        'SELECT senha FROM usuarios WHERE id = $1 AND empresa_id = $2 AND ativo = true',
        [usuario_id, empresa_id]
    );

    return rows.length ? rows[0].senha : null;
}

async function buscarUsuario(empresa_id, usuario_id, client = db) {
    const { rows } = await client.query(
        `SELECT id, nome, email, papel, ativo
         FROM usuarios
         WHERE id = $1 AND empresa_id = $2`,
        [usuario_id, empresa_id]
    );

    return rows.length ? rows[0] : null;
}

async function concessaoAtiva(empresa_id, usuario_id, client = db) {
    const { rows } = await client.query(
        `SELECT id, concedido_por, concedido_em
         FROM usuario_privilegios
         WHERE empresa_id = $1 AND usuario_id = $2 AND capacidade = 'administrador' AND revogado_em IS NULL
         FOR UPDATE`,
        [empresa_id, usuario_id]
    );

    return rows.length ? rows[0] : null;
}

async function inserirConcessao({ empresa_id, usuario_id, concedido_por, motivo }, client = db) {
    const { rows } = await client.query(
        `INSERT INTO usuario_privilegios (empresa_id, usuario_id, capacidade, concedido_por, motivo)
         VALUES ($1, $2, 'administrador', $3, $4)
         RETURNING id, concedido_em`,
        [empresa_id, usuario_id, concedido_por, motivo]
    );

    return rows[0];
}

async function revogarConcessao({ id, empresa_id, revogado_por }, client = db) {
    const { rowCount } = await client.query(
        `UPDATE usuario_privilegios
         SET revogado_em = NOW(), revogado_por = $3
         WHERE id = $1 AND empresa_id = $2 AND revogado_em IS NULL`,
        [id, empresa_id, revogado_por]
    );

    return rowCount;
}

async function registrarEvento(
    { empresa_id, escopo, acao, alvo_usuario_id = null, alvo_cargo = null, executado_por, motivo, usuarios_afetados = 0 },
    client = db
) {
    const { rows } = await client.query(
        `INSERT INTO privilegios_eventos
            (empresa_id, escopo, acao, alvo_usuario_id, alvo_cargo, executado_por, motivo, usuarios_afetados)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, criado_em`,
        [empresa_id, escopo, acao, alvo_usuario_id, alvo_cargo, executado_por, motivo, usuarios_afetados]
    );

    return rows[0];
}

// Administradores EFETIVOS e ativos: Admin de cargo, cargo com a capacidade `administrador` ligado
// no comércio, ou concessão individual ativa. É a base da proteção do último Admin.
const CONDICAO_ADMIN_EFETIVO = `
    u.ativo = true AND (
        u.papel = 'admin'
        OR (c.ativo = true AND 'administrador' = ANY(c.capacidades))
        OR EXISTS (
            SELECT 1 FROM usuario_privilegios p
            WHERE p.empresa_id = u.empresa_id AND p.usuario_id = u.id
              AND p.capacidade = 'administrador' AND p.revogado_em IS NULL
        )
    )`;

async function contarAdministradoresEfetivos(empresa_id, client = db) {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM usuarios u
         LEFT JOIN cargos_empresa c ON c.empresa_id = u.empresa_id AND c.cargo = u.papel
         WHERE u.empresa_id = $1 AND ${CONDICAO_ADMIN_EFETIVO}`,
        [empresa_id]
    );

    return rows[0].total;
}

async function listarAdministradores(empresa_id) {
    const { rows } = await db.query(
        `SELECT u.id, u.nome, u.email, u.papel AS cargo,
                (u.papel = 'admin') AS admin_pelo_cargo_base,
                COALESCE(c.ativo = true AND 'administrador' = ANY(c.capacidades), false) AS admin_pelo_cargo,
                (p.id IS NOT NULL) AS admin_concedido,
                p.concedido_em, p.concedido_por
         FROM usuarios u
         LEFT JOIN cargos_empresa c ON c.empresa_id = u.empresa_id AND c.cargo = u.papel
         LEFT JOIN usuario_privilegios p ON p.empresa_id = u.empresa_id AND p.usuario_id = u.id
              AND p.capacidade = 'administrador' AND p.revogado_em IS NULL
         WHERE u.empresa_id = $1 AND ${CONDICAO_ADMIN_EFETIVO}
         ORDER BY u.nome, u.id`,
        [empresa_id]
    );

    return rows;
}

async function listarUsuarios(empresa_id) {
    const { rows } = await db.query(
        `SELECT u.id, u.nome, u.email, u.papel AS cargo, u.ativo,
                (u.papel = 'admin'
                 OR COALESCE(c.ativo = true AND 'administrador' = ANY(c.capacidades), false)
                 OR p.id IS NOT NULL) AS administrador,
                (p.id IS NOT NULL) AS admin_concedido
         FROM usuarios u
         LEFT JOIN cargos_empresa c ON c.empresa_id = u.empresa_id AND c.cargo = u.papel
         LEFT JOIN usuario_privilegios p ON p.empresa_id = u.empresa_id AND p.usuario_id = u.id
              AND p.capacidade = 'administrador' AND p.revogado_em IS NULL
         WHERE u.empresa_id = $1
         ORDER BY u.nome, u.id`,
        [empresa_id]
    );

    return rows;
}

async function contarUsuariosAtivosDoCargo(empresa_id, cargo, client = db) {
    const { rows } = await client.query(
        'SELECT COUNT(*)::int AS total FROM usuarios WHERE empresa_id = $1 AND papel = $2 AND ativo = true',
        [empresa_id, cargo]
    );

    return rows[0].total;
}

// Revogação derruba as sessões já emitidas (authMiddleware compara token_version).
async function incrementarTokenDoUsuario(empresa_id, usuario_id, client = db) {
    await client.query(
        'UPDATE usuarios SET token_version = token_version + 1 WHERE id = $1 AND empresa_id = $2',
        [usuario_id, empresa_id]
    );
}

async function incrementarTokenDoCargo(empresa_id, cargo, client = db) {
    await client.query(
        'UPDATE usuarios SET token_version = token_version + 1 WHERE empresa_id = $1 AND papel = $2',
        [empresa_id, cargo]
    );
}

async function listarEventos(empresa_id, { limit, offset, escopo, alvo_usuario_id, alvo_cargo }) {
    const filtros = ['e.empresa_id = $1'];
    const valores = [empresa_id];

    if (escopo) { valores.push(escopo); filtros.push(`e.escopo = $${valores.length}`); }
    if (alvo_usuario_id) { valores.push(alvo_usuario_id); filtros.push(`e.alvo_usuario_id = $${valores.length}`); }
    if (alvo_cargo) { valores.push(alvo_cargo); filtros.push(`e.alvo_cargo = $${valores.length}`); }

    const where = filtros.join(' AND ');

    const total = await db.query(`SELECT COUNT(*)::int AS total FROM privilegios_eventos e WHERE ${where}`, valores);

    valores.push(limit, offset);
    const { rows } = await db.query(
        `SELECT e.id, e.escopo, e.acao, e.capacidade, e.alvo_usuario_id, au.nome AS alvo_usuario_nome,
                e.alvo_cargo, e.executado_por, ex.nome AS executado_por_nome, ex.email AS executado_por_login,
                e.motivo, e.usuarios_afetados, e.criado_em
         FROM privilegios_eventos e
         LEFT JOIN usuarios au ON au.id = e.alvo_usuario_id AND au.empresa_id = e.empresa_id
         JOIN usuarios ex ON ex.id = e.executado_por AND ex.empresa_id = e.empresa_id
         WHERE ${where}
         ORDER BY e.criado_em DESC, e.id DESC
         LIMIT $${valores.length - 1} OFFSET $${valores.length}`,
        valores
    );

    return { items: rows, total: total.rows[0].total };
}

module.exports = {
    travarEmpresa,
    buscarSenhaHash,
    buscarUsuario,
    concessaoAtiva,
    inserirConcessao,
    revogarConcessao,
    registrarEvento,
    contarAdministradoresEfetivos,
    listarAdministradores,
    listarUsuarios,
    contarUsuariosAtivosDoCargo,
    incrementarTokenDoUsuario,
    incrementarTokenDoCargo,
    listarEventos
};
