-- Privilégio de Admin delegável (SPEC "Cargos, permissões e cancelamento de venda", PR 1b).
--
-- 1) usuario_privilegios: concessão INDIVIDUAL de uma capacidade (hoje só `administrador`) a um
--    funcionário. Revogação é lógica (revogado_em/revogado_por): a linha nunca é apagada.
--    No máximo uma concessão ATIVA por (empresa, usuário, capacidade).
-- 2) privilegios_eventos: trilha de auditoria imutável de TODA concessão/revogação, tanto a
--    individual quanto a anexada a um cargo (cargos_empresa.capacidades). A aplicação só faz INSERT.
--
-- Aditiva e idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS usuario_privilegios (
    id              SERIAL       PRIMARY KEY,
    empresa_id      INTEGER      NOT NULL REFERENCES empresas(id),
    usuario_id      INTEGER      NOT NULL REFERENCES usuarios(id),
    capacidade      VARCHAR(30)  NOT NULL,
    concedido_por   INTEGER      NOT NULL REFERENCES usuarios(id),
    concedido_em    TIMESTAMP    NOT NULL DEFAULT NOW(),
    motivo          TEXT         NOT NULL,
    revogado_em     TIMESTAMP,
    revogado_por    INTEGER      REFERENCES usuarios(id),
    CONSTRAINT usuario_privilegios_capacidade_chk CHECK (capacidade IN ('administrador')),
    CONSTRAINT usuario_privilegios_revogacao_chk CHECK (
        (revogado_em IS NULL AND revogado_por IS NULL) OR (revogado_em IS NOT NULL AND revogado_por IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_privilegios_ativo
    ON usuario_privilegios (empresa_id, usuario_id, capacidade)
    WHERE revogado_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_usuario_privilegios_empresa_usuario
    ON usuario_privilegios (empresa_id, usuario_id);

CREATE TABLE IF NOT EXISTS privilegios_eventos (
    id               SERIAL       PRIMARY KEY,
    empresa_id       INTEGER      NOT NULL REFERENCES empresas(id),
    escopo           VARCHAR(10)  NOT NULL,
    acao             VARCHAR(10)  NOT NULL,
    capacidade       VARCHAR(30)  NOT NULL DEFAULT 'administrador',
    alvo_usuario_id  INTEGER      REFERENCES usuarios(id),
    alvo_cargo       VARCHAR(20),
    executado_por    INTEGER      NOT NULL REFERENCES usuarios(id),
    motivo           TEXT         NOT NULL,
    usuarios_afetados INTEGER     NOT NULL DEFAULT 0,
    criado_em        TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT privilegios_eventos_escopo_chk CHECK (escopo IN ('usuario', 'cargo')),
    CONSTRAINT privilegios_eventos_acao_chk CHECK (acao IN ('conceder', 'revogar')),
    CONSTRAINT privilegios_eventos_alvo_chk CHECK (
        (escopo = 'usuario' AND alvo_usuario_id IS NOT NULL AND alvo_cargo IS NULL)
        OR (escopo = 'cargo' AND alvo_cargo IS NOT NULL AND alvo_usuario_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_privilegios_eventos_empresa_data
    ON privilegios_eventos (empresa_id, criado_em DESC, id DESC);

-- Reversão manual (não executada pelo runner; só se nenhuma concessão estiver em uso):
--   DROP TABLE IF EXISTS privilegios_eventos;
--   DROP TABLE IF EXISTS usuario_privilegios;
