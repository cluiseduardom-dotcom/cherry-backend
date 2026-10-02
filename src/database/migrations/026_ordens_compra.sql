CREATE TABLE IF NOT EXISTS ordens_compra (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    filial_id BIGINT,
    numero VARCHAR(30) NOT NULL,
    setor_id BIGINT,
    solicitante_id BIGINT,
    aprovador_id BIGINT,
    centro_custo_id BIGINT,
    projeto_id BIGINT,
    origem VARCHAR(30) NOT NULL DEFAULT 'PLANEJADA',
    prioridade VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    data_solicitacao DATE NOT NULL DEFAULT CURRENT_DATE,
    data_necessidade DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO',
    justificativa TEXT,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ordens_compra_numero_empresa UNIQUE (empresa_id, numero),
    CONSTRAINT ck_ordens_compra_origem CHECK (origem IN ('PLANEJADA', 'COMPRA_DIRETA')),
    CONSTRAINT ck_ordens_compra_prioridade CHECK (prioridade IN ('BAIXA','NORMAL','ALTA','URGENTE')),
    CONSTRAINT ck_ordens_compra_status CHECK (
        status IN (
            'RASCUNHO',
            'PENDENTE_APROVACAO',
            'APROVADA',
            'EM_COMPRAS',
            'PARCIALMENTE_ATENDIDA',
            'ATENDIDA',
            'REJEITADA',
            'CANCELADA'
        )
    )
);

CREATE TABLE IF NOT EXISTS ordens_compra_itens (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    ordem_compra_id BIGINT NOT NULL REFERENCES ordens_compra(id),
    produto_id BIGINT,
    descricao_snapshot VARCHAR(255) NOT NULL,
    quantidade_solicitada NUMERIC(18,4) NOT NULL,
    quantidade_atendida NUMERIC(18,4) NOT NULL DEFAULT 0,
    unidade VARCHAR(20) NOT NULL DEFAULT 'UN',
    data_necessidade DATE,
    especificacao TEXT,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_oc_item_quantidade CHECK (quantidade_solicitada > 0),
    CONSTRAINT ck_oc_item_atendida CHECK (
        quantidade_atendida >= 0 AND quantidade_atendida <= quantidade_solicitada
    )
);

CREATE INDEX IF NOT EXISTS idx_ordens_compra_empresa_status
    ON ordens_compra (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_ordens_compra_empresa_numero
    ON ordens_compra (empresa_id, numero);

CREATE INDEX IF NOT EXISTS idx_ordens_compra_itens_empresa
    ON ordens_compra_itens (empresa_id, ordem_compra_id);

CREATE INDEX IF NOT EXISTS idx_ordens_compra_itens_produto
    ON ordens_compra_itens (empresa_id, produto_id);
