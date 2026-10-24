-- Trilha de auditoria da gestão de usuários (criar, bloquear, desbloquear).
--
-- Insere-só: a aplicação nunca faz UPDATE nem DELETE nesta tabela, e o banco recusa (trigger abaixo). Cada linha diz QUEM
-- (executado_por) fez O QUÊ (acao) com QUEM (alvo_usuario_id), em qual cargo e por quê
-- (motivo, obrigatório em bloquear/desbloquear; opcional em criar).
--
-- Separada de privilegios_eventos de propósito: aquela tabela é específica de concessão
-- de privilégio (CHECKs de escopo/ação) e não deve virar um depósito genérico.
--
-- Aditiva e idempotente (CREATE ... IF NOT EXISTS): não altera tabelas existentes.

-- Referência composta: alvo e executor precisam ser da MESMA empresa do evento (um id de outra
-- empresa é recusado pelo banco, não só pela aplicação). Exige a unique (id, empresa_id) em
-- usuarios, redundante com a PK e sem custo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_id_empresa ON usuarios (id, empresa_id);

CREATE TABLE IF NOT EXISTS usuarios_eventos (
    id               SERIAL       PRIMARY KEY,
    empresa_id       INTEGER      NOT NULL REFERENCES empresas(id),
    acao             VARCHAR(12)  NOT NULL,
    alvo_usuario_id  INTEGER      NOT NULL,
    cargo_alvo       VARCHAR(20)  NOT NULL,
    executado_por    INTEGER      NOT NULL,
    motivo           TEXT,
    criado_em        TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT usuarios_eventos_alvo_fk FOREIGN KEY (alvo_usuario_id, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT usuarios_eventos_executor_fk FOREIGN KEY (executado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT usuarios_eventos_acao_chk CHECK (acao IN ('criar', 'bloquear', 'desbloquear')),
    CONSTRAINT usuarios_eventos_motivo_chk CHECK (
        acao = 'criar' OR (motivo IS NOT NULL AND length(btrim(motivo)) >= 3)
    )
);

CREATE INDEX IF NOT EXISTS idx_usuarios_eventos_empresa_data
    ON usuarios_eventos (empresa_id, criado_em DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_usuarios_eventos_empresa_alvo
    ON usuarios_eventos (empresa_id, alvo_usuario_id);

-- Imutabilidade no banco (mesmo padrão de cancelamentos_venda): UPDATE e DELETE são recusados.
-- A única exceção é a limpeza das empresas descartáveis dos testes de integração, que liga o
-- parâmetro de sessão vertumno.limpeza_teste dentro da própria transação.
CREATE OR REPLACE FUNCTION usuarios_eventos_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'usuarios_eventos é imutável (% recusado)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_usuarios_eventos_imutavel ON usuarios_eventos;
CREATE TRIGGER trg_usuarios_eventos_imutavel
    BEFORE UPDATE OR DELETE ON usuarios_eventos
    FOR EACH ROW EXECUTE FUNCTION usuarios_eventos_imutavel();

-- Reversão manual (não executada pelo runner; só se a trilha não for mais necessária):
--   DROP TRIGGER IF EXISTS trg_usuarios_eventos_imutavel ON usuarios_eventos;
--   DROP FUNCTION IF EXISTS usuarios_eventos_imutavel();
--   DROP TABLE IF EXISTS usuarios_eventos;
