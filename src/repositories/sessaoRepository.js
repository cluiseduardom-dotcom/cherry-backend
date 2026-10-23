const db = require('../config/db');

// Estado que decide se um JWT ainda vale E o que o usuário pode agora. Filtra por id E
// empresa_id (do próprio token) na mesma query; null = usuário inexistente.
//
// O cargo (papel) e a configuração dele vêm do BANCO a cada requisição, não do JWT:
// mudar o cargo ou as capacidades de alguém vale na próxima chamada, sem esperar o token
// de 8 h expirar. Uma única ida ao banco (LEFT JOIN em cargos_empresa).
async function buscarEstado(usuario_id, empresa_id) {
    const { rows } = await db.query(
        `SELECT u.ativo, u.token_version, u.papel, u.email, e.status AS empresa_status,
                (c.empresa_id IS NOT NULL) AS cargo_configurado,
                c.nivel AS cargo_nivel, c.ativo AS cargo_ativo, c.capacidades AS cargo_capacidades,
                EXISTS (
                    SELECT 1 FROM usuario_privilegios p
                    WHERE p.empresa_id = u.empresa_id AND p.usuario_id = u.id
                      AND p.capacidade = 'administrador' AND p.revogado_em IS NULL
                ) AS administrador_concedido
         FROM usuarios u
         JOIN empresas e ON e.id = u.empresa_id
         LEFT JOIN cargos_empresa c ON c.empresa_id = u.empresa_id AND c.cargo = u.papel
         WHERE u.id = $1 AND u.empresa_id = $2`,
        [usuario_id, empresa_id]
    );

    return rows.length ? rows[0] : null;
}

module.exports = { buscarEstado };
