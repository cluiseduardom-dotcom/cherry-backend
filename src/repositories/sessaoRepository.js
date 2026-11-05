const db = require('../config/db');

const HOJE_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

// Plano ativo da empresa na mesma regra de taxasPlataformaRepository.buscarPlanoDaEmpresa (ativo, vigente,
// mais recente primeiro; sem plano vale o padrão `sem_mensalidade`). Diferença deliberada: aqui um plano
// comercial inativo não derruba a sessão (lá derruba a venda); as inclusões dele continuam valendo.
// O teste de integração compara os dois para não divergirem.
const PLANO_DA_EMPRESA_SQL = `COALESCE(
    (SELECT ep.plano_id
     FROM empresa_planos ep
     WHERE ep.empresa_id = u.empresa_id
       AND ep.ativo = true
       AND ep.vigencia_inicio <= ${HOJE_SQL}
       AND (ep.vigencia_fim IS NULL OR ep.vigencia_fim >= ${HOJE_SQL})
     ORDER BY ep.vigencia_inicio DESC, ep.id DESC
     LIMIT 1),
    (SELECT pc.id FROM planos_comerciais pc WHERE pc.codigo = 'sem_mensalidade')
)`;

const LIGACAO_VIGENTE_SQL = `ef.empresa_id = u.empresa_id
          AND ef.funcionalidade = f.codigo
          AND ef.vigencia_inicio <= ${HOJE_SQL}
          AND (ef.vigencia_fim IS NULL OR ef.vigencia_fim >= ${HOJE_SQL})`;

// Estado que decide se um JWT ainda vale E o que o usuário pode agora. Filtra por id E
// empresa_id (do próprio token) na mesma query; null = usuário inexistente.
//
// O cargo (papel) e a configuração dele vêm do BANCO a cada requisição, não do JWT:
// mudar o cargo ou as capacidades de alguém vale na próxima chamada, sem esperar o token
// de 8 h expirar. Uma única ida ao banco (LEFT JOIN em cargos_empresa).
async function buscarEstado(usuario_id, empresa_id) {
    const { rows } = await db.query(
        `SELECT u.ativo, u.token_version, u.papel, u.email, u.senha_temporaria, e.status AS empresa_status,
                (c.empresa_id IS NOT NULL) AS cargo_configurado,
                c.nivel AS cargo_nivel, c.ativo AS cargo_ativo, c.capacidades AS cargo_capacidades,
                EXISTS (
                    SELECT 1 FROM usuario_privilegios p
                    WHERE p.empresa_id = u.empresa_id AND p.usuario_id = u.id
                      AND p.capacidade = 'administrador' AND p.revogado_em IS NULL
                ) AS administrador_concedido,
                -- Funcionalidades ligadas da empresa: (plano inclui OU ligação avulsa vigente)
                -- E NÃO desligada de forma vigente. Desligar vence. Sem ida extra ao banco.
                ARRAY(
                    SELECT f.codigo
                    FROM funcionalidades f
                    WHERE (
                            EXISTS (
                                SELECT 1 FROM plano_funcionalidades pf
                                WHERE pf.plano_id = ${PLANO_DA_EMPRESA_SQL}
                                  AND pf.funcionalidade = f.codigo
                            )
                            OR EXISTS (
                                SELECT 1 FROM empresa_funcionalidades ef
                                WHERE ${LIGACAO_VIGENTE_SQL} AND ef.ligada = true
                            )
                          )
                      AND NOT EXISTS (
                            SELECT 1 FROM empresa_funcionalidades ef
                            WHERE ${LIGACAO_VIGENTE_SQL} AND ef.ligada = false
                          )
                    ORDER BY f.codigo
                ) AS funcionalidades
         FROM usuarios u
         JOIN empresas e ON e.id = u.empresa_id
         LEFT JOIN cargos_empresa c ON c.empresa_id = u.empresa_id AND c.cargo = u.papel
         WHERE u.id = $1 AND u.empresa_id = $2`,
        [usuario_id, empresa_id]
    );

    return rows.length ? rows[0] : null;
}

module.exports = { buscarEstado };
