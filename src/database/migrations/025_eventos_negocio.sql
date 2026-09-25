CREATE TABLE IF NOT EXISTS eventos_negocio (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    filial_id BIGINT,
    tipo_evento VARCHAR(100) NOT NULL,
    entidade_tipo VARCHAR(50) NOT NULL,
    entidade_id BIGINT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    usuario_id BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    tentativas INTEGER NOT NULL DEFAULT 0,
    ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processado_em TIMESTAMPTZ,
    erro TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT eventos_negocio_status_check
        CHECK (status IN ('PENDENTE', 'PROCESSANDO', 'PROCESSADO', 'ERRO'))
);

CREATE INDEX IF NOT EXISTS idx_eventos_empresa_status
    ON eventos_negocio (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_eventos_entidade
    ON eventos_negocio (empresa_id, entidade_tipo, entidade_id);

CREATE INDEX IF NOT EXISTS idx_eventos_tipo
    ON eventos_negocio (empresa_id, tipo_evento);

CREATE INDEX IF NOT EXISTS idx_eventos_ocorrido
    ON eventos_negocio (empresa_id, ocorrido_em);
