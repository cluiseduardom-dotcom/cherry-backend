-- Trilha de auditoria da gestão de usuários (criar, bloquear, desbloquear).
--
-- Insere-só: a aplicação nunca faz UPDATE nem DELETE nesta tabela. Cada linha diz QUEM
-- (executado_por) fez O QUÊ (acao) com QUEM (alvo_usuario_id), em qual cargo e por quê
-- (motivo, obrigatório em bloquear/desbloquear; opcional em criar).
--
-- Separada de privilegios_eventos de propósito: aquela tabela é específica de concessão
-- de privilégio (CHECKs de escopo/ação) e não deve virar um depósito genérico.
--
-- Aditiva e idempotente (CREATE ... IF NOT EXISTS): não altera tabelas existentes.

CREATE TABLE IF NOT EXISTS usuarios_eventos (
    id               SERIAL       PRIMARY KEY,
    empresa_id       INTEGER      NOT NULL REFERENCES empresas(id),
    acao             VARCHAR(12)  NOT NULL,
    alvo_usuario_id  INTEGER      NOT NULL REFERENCES usuarios(id),
    cargo_alvo       VARCHAR(20)  NOT NULL,
    executado_por    INTEGER      NOT NULL REFERENCES usuarios(id),
    motivo           TEXT,
    criado_em        TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT usuarios_eventos_acao_chk CHECK (acao IN ('criar', 'bloquear', 'desbloquear')),
    CONSTRAINT usuarios_eventos_motivo_chk CHECK (
        acao = 'criar' OR (motivo IS NOT NULL AND length(btrim(motivo)) >= 3)
    )
);

CREATE INDEX IF NOT EXISTS idx_usuarios_eventos_empresa_data
    ON usuarios_eventos (empresa_id, criado_em DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_usuarios_eventos_empresa_alvo
    ON usuarios_eventos (empresa_id, alvo_usuario_id);

-- Reversão manual (não executada pelo runner; só se a trilha não for mais necessária):
--   DROP TABLE IF EXISTS usuarios_eventos;
