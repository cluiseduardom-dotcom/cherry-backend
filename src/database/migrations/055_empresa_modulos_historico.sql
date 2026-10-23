-- Histórico IMUTÁVEL das ativações/desativações de módulo por empresa (ADR-007, fatia 3).
-- Cada alteração feita pelo painel interno da GiroOne grava uma linha: quem (responsável
-- informado), por quê (justificativa), qual módulo, para qual estado e quando. A aplicação só
-- faz INSERT; um gatilho recusa UPDATE e DELETE.
--
-- Aditiva e idempotente. Reversão manual no rodapé.
CREATE TABLE IF NOT EXISTS empresa_modulos_historico (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    modulo VARCHAR(30) NOT NULL,
    ativo BOOLEAN NOT NULL,
    justificativa TEXT NOT NULL,
    responsavel VARCHAR(120) NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT empresa_modulos_historico_modulo_chk
        CHECK (modulo IN ('grade', 'fracionario', 'rastreio_unidade', 'fiscal', 'multi_pdv', 'servicos_agenda')),
    CONSTRAINT empresa_modulos_historico_justificativa_chk CHECK (btrim(justificativa) <> ''),
    CONSTRAINT empresa_modulos_historico_responsavel_chk CHECK (btrim(responsavel) <> '')
);

CREATE INDEX IF NOT EXISTS idx_empresa_modulos_historico_empresa
    ON empresa_modulos_historico (empresa_id, criado_em);

CREATE OR REPLACE FUNCTION empresa_modulos_historico_imutavel() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'empresa_modulos_historico é imutável (% não permitido)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_empresa_modulos_historico_imutavel ON empresa_modulos_historico;
CREATE TRIGGER trg_empresa_modulos_historico_imutavel
    BEFORE UPDATE OR DELETE ON empresa_modulos_historico
    FOR EACH ROW EXECUTE FUNCTION empresa_modulos_historico_imutavel();

-- Reversão manual (não executada pelo runner):
--   DROP TRIGGER IF EXISTS trg_empresa_modulos_historico_imutavel ON empresa_modulos_historico;
--   DROP FUNCTION IF EXISTS empresa_modulos_historico_imutavel();
--   DROP TABLE IF EXISTS empresa_modulos_historico;
