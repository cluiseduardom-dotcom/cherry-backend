CREATE TABLE IF NOT EXISTS cotacoes (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    filial_id BIGINT,
    numero VARCHAR(30) NOT NULL,
    solicitante_id BIGINT,
    comprador_id BIGINT,
    data_abertura DATE,
    data_limite DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cotacoes_numero_empresa UNIQUE (empresa_id, numero),
    CONSTRAINT ck_cotacoes_status CHECK (
        status IN ('RASCUNHO', 'ABERTA', 'EM_ANALISE', 'ENCERRADA', 'CANCELADA')
    )
);

CREATE TABLE IF NOT EXISTS cotacoes_itens (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    cotacao_id BIGINT NOT NULL REFERENCES cotacoes(id),
    ordem_compra_item_id BIGINT,
    produto_id BIGINT,
    descricao_snapshot VARCHAR(255) NOT NULL,
    quantidade_solicitada NUMERIC(18,4) NOT NULL,
    unidade VARCHAR(20) NOT NULL DEFAULT 'UN',
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_cotacoes_item_quantidade CHECK (quantidade_solicitada > 0)
);

CREATE TABLE IF NOT EXISTS cotacoes_fornecedores (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    cotacao_id BIGINT NOT NULL REFERENCES cotacoes(id),
    fornecedor_id BIGINT NOT NULL,
    contato_nome VARCHAR(150),
    contato_email VARCHAR(255),
    contato_telefone VARCHAR(40),
    data_envio TIMESTAMPTZ,
    data_resposta TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cotacao_fornecedor UNIQUE (empresa_id, cotacao_id, fornecedor_id),
    CONSTRAINT ck_cotacao_fornecedor_status CHECK (
        status IN ('PENDENTE', 'RESPONDIDA', 'SEM_RESPOSTA', 'RECUSADA')
    )
);

CREATE TABLE IF NOT EXISTS cotacoes_fornecedores_itens (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    cotacao_fornecedor_id BIGINT NOT NULL REFERENCES cotacoes_fornecedores(id),
    cotacao_item_id BIGINT NOT NULL REFERENCES cotacoes_itens(id),
    quantidade_ofertada NUMERIC(18,4) NOT NULL,
    preco_unitario NUMERIC(18,6) NOT NULL,
    desconto NUMERIC(18,2) NOT NULL DEFAULT 0,
    frete NUMERIC(18,2) NOT NULL DEFAULT 0,
    prazo_entrega_dias INTEGER,
    condicao_pagamento VARCHAR(255),
    validade_proposta DATE,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cotacao_fornecedor_item UNIQUE (empresa_id, cotacao_fornecedor_id, cotacao_item_id),
    CONSTRAINT ck_cotacao_oferta_quantidade CHECK (quantidade_ofertada > 0),
    CONSTRAINT ck_cotacao_oferta_preco CHECK (preco_unitario >= 0),
    CONSTRAINT ck_cotacao_oferta_desconto CHECK (desconto >= 0),
    CONSTRAINT ck_cotacao_oferta_frete CHECK (frete >= 0),
    CONSTRAINT ck_cotacao_oferta_prazo CHECK (
        prazo_entrega_dias IS NULL OR prazo_entrega_dias >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_cotacoes_empresa_status
    ON cotacoes (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_cotacoes_empresa_numero
    ON cotacoes (empresa_id, numero);

CREATE INDEX IF NOT EXISTS idx_cotacoes_itens_empresa
    ON cotacoes_itens (empresa_id, cotacao_id);

CREATE INDEX IF NOT EXISTS idx_cotacoes_itens_oc_item
    ON cotacoes_itens (empresa_id, ordem_compra_item_id);

CREATE INDEX IF NOT EXISTS idx_cotacoes_fornecedores_empresa
    ON cotacoes_fornecedores (empresa_id, cotacao_id);

CREATE INDEX IF NOT EXISTS idx_cotacoes_fornecedores_itens_empresa
    ON cotacoes_fornecedores_itens (empresa_id, cotacao_fornecedor_id, cotacao_item_id);
