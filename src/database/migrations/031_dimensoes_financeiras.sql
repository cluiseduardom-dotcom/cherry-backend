CREATE TABLE IF NOT EXISTS centros_custo (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresas(id),
    filial_id BIGINT,
    codigo VARCHAR(50) NOT NULL,
    nome VARCHAR(150) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    centro_custo_pai_id BIGINT REFERENCES centros_custo(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_centros_custo_empresa_codigo UNIQUE (empresa_id, codigo)
);

CREATE TABLE IF NOT EXISTS projetos (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresas(id),
    filial_id BIGINT,
    codigo VARCHAR(50) NOT NULL,
    nome VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
    data_inicio DATE,
    data_fim DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_projetos_empresa_codigo UNIQUE (empresa_id, codigo),
    CONSTRAINT ck_projetos_status CHECK (status IN ('ATIVO','ENCERRADO','CANCELADO')),
    CONSTRAINT ck_projetos_periodo CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio)
);

ALTER TABLE contas_pagar
    ADD COLUMN IF NOT EXISTS centro_custo_id BIGINT REFERENCES centros_custo(id),
    ADD COLUMN IF NOT EXISTS projeto_id BIGINT REFERENCES projetos(id);

ALTER TABLE contas_receber
    ADD COLUMN IF NOT EXISTS centro_custo_id BIGINT REFERENCES centros_custo(id),
    ADD COLUMN IF NOT EXISTS projeto_id BIGINT REFERENCES projetos(id);

ALTER TABLE despesas_fixas
    ADD COLUMN IF NOT EXISTS centro_custo_id BIGINT REFERENCES centros_custo(id),
    ADD COLUMN IF NOT EXISTS projeto_id BIGINT REFERENCES projetos(id);

CREATE INDEX IF NOT EXISTS idx_centros_custo_empresa_ativo
    ON centros_custo (empresa_id, ativo);

CREATE INDEX IF NOT EXISTS idx_centros_custo_pai
    ON centros_custo (empresa_id, centro_custo_pai_id);

CREATE INDEX IF NOT EXISTS idx_projetos_empresa_status
    ON projetos (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_centro_custo
    ON contas_pagar (empresa_id, centro_custo_id);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_projeto
    ON contas_pagar (empresa_id, projeto_id);

CREATE INDEX IF NOT EXISTS idx_contas_receber_centro_custo
    ON contas_receber (empresa_id, centro_custo_id);

CREATE INDEX IF NOT EXISTS idx_contas_receber_projeto
    ON contas_receber (empresa_id, projeto_id);

CREATE INDEX IF NOT EXISTS idx_despesas_fixas_centro_custo
    ON despesas_fixas (centro_custo_id);

CREATE INDEX IF NOT EXISTS idx_despesas_fixas_projeto
    ON despesas_fixas (projeto_id);
