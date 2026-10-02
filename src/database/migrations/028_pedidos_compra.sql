CREATE TABLE IF NOT EXISTS pedidos_compra (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    filial_id BIGINT,
    numero VARCHAR(30) NOT NULL,
    fornecedor_id BIGINT NOT NULL,
    cotacao_id BIGINT,
    comprador_id BIGINT,
    solicitante_id BIGINT,
    data_emissao DATE,
    data_prevista_entrega DATE,
    condicao_pagamento VARCHAR(255),
    prazo_pagamento_dias INTEGER,
    forma_pagamento VARCHAR(50),
    frete_tipo VARCHAR(30),
    frete_valor NUMERIC(18,2) NOT NULL DEFAULT 0,
    desconto NUMERIC(18,2) NOT NULL DEFAULT 0,
    outras_despesas NUMERIC(18,2) NOT NULL DEFAULT 0,
    total NUMERIC(18,2) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO',
    observacoes TEXT,
    enviado_em TIMESTAMPTZ,
    confirmado_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pedidos_compra_numero_empresa UNIQUE (empresa_id, numero),
    CONSTRAINT ck_pedidos_compra_status CHECK (
        status IN (
            'RASCUNHO',
            'PENDENTE_APROVACAO',
            'APROVADO',
            'ENVIADO',
            'CONFIRMADO',
            'PARCIALMENTE_RECEBIDO',
            'RECEBIDO',
            'CANCELADO'
        )
    ),
    CONSTRAINT ck_pedidos_compra_prazo CHECK (
        prazo_pagamento_dias IS NULL OR prazo_pagamento_dias >= 0
    ),
    CONSTRAINT ck_pedidos_compra_frete CHECK (frete_valor >= 0),
    CONSTRAINT ck_pedidos_compra_desconto CHECK (desconto >= 0),
    CONSTRAINT ck_pedidos_compra_outras_despesas CHECK (outras_despesas >= 0),
    CONSTRAINT ck_pedidos_compra_total CHECK (total >= 0)
);

CREATE TABLE IF NOT EXISTS pedidos_compra_itens (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    pedido_compra_id BIGINT NOT NULL REFERENCES pedidos_compra(id),
    produto_id BIGINT,
    descricao_snapshot VARCHAR(255) NOT NULL,
    quantidade NUMERIC(18,4) NOT NULL,
    quantidade_recebida NUMERIC(18,4) NOT NULL DEFAULT 0,
    unidade VARCHAR(20) NOT NULL DEFAULT 'UN',
    preco_unitario NUMERIC(18,6) NOT NULL DEFAULT 0,
    desconto NUMERIC(18,2) NOT NULL DEFAULT 0,
    prazo_entrega_dias INTEGER,
    data_prevista_entrega DATE,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_pedido_item_quantidade CHECK (quantidade > 0),
    CONSTRAINT ck_pedido_item_recebida CHECK (
        quantidade_recebida >= 0 AND quantidade_recebida <= quantidade
    ),
    CONSTRAINT ck_pedido_item_preco CHECK (preco_unitario >= 0),
    CONSTRAINT ck_pedido_item_desconto CHECK (desconto >= 0),
    CONSTRAINT ck_pedido_item_prazo CHECK (
        prazo_entrega_dias IS NULL OR prazo_entrega_dias >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_pedidos_compra_empresa_status
    ON pedidos_compra (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_pedidos_compra_empresa_numero
    ON pedidos_compra (empresa_id, numero);

CREATE INDEX IF NOT EXISTS idx_pedidos_compra_fornecedor
    ON pedidos_compra (empresa_id, fornecedor_id);

CREATE INDEX IF NOT EXISTS idx_pedidos_compra_cotacao
    ON pedidos_compra (empresa_id, cotacao_id);

CREATE INDEX IF NOT EXISTS idx_pedidos_compra_itens_empresa
    ON pedidos_compra_itens (empresa_id, pedido_compra_id);

CREATE INDEX IF NOT EXISTS idx_pedidos_compra_itens_produto
    ON pedidos_compra_itens (empresa_id, produto_id);
