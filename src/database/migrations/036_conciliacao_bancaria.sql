CREATE TABLE IF NOT EXISTS conciliacoes_bancarias (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresas(id),
    movimento_bancario_id BIGINT NOT NULL REFERENCES movimentos_bancarios(id),
    tipo VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    status VARCHAR(20) NOT NULL DEFAULT 'CONCILIADA',
    referencia_externa VARCHAR(255),
    valor_externo NUMERIC(18,2),
    data_externa TIMESTAMPTZ,
    descricao_externa VARCHAR(255),
    usuario_id BIGINT REFERENCES usuarios(id),
    conciliada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    observacao TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_conc_tipo CHECK (tipo IN ('MANUAL','AUTOMATICA','IMPORTADA')),
    CONSTRAINT ck_conc_status CHECK (status IN ('CONCILIADA','DESFEITA')),
    CONSTRAINT ck_conc_valor CHECK (valor_externo IS NULL OR valor_externo > 0),
    CONSTRAINT uq_conc_movimento UNIQUE (movimento_bancario_id)
);

CREATE INDEX IF NOT EXISTS idx_conc_banc_empresa_status
    ON conciliacoes_bancarias (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_conc_banc_empresa_referencia
    ON conciliacoes_bancarias (empresa_id, referencia_externa);
