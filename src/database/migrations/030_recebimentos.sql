CREATE TABLE IF NOT EXISTS recebimentos (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    filial_id BIGINT,
    numero VARCHAR(30) NOT NULL,
    pedido_compra_id BIGINT NOT NULL REFERENCES pedidos_compra(id),
    fornecedor_id BIGINT NOT NULL,
    data_recebimento DATE NOT NULL DEFAULT CURRENT_DATE,
    usuario_id BIGINT,
    numero_nf VARCHAR(30),
    serie_nf VARCHAR(10),
    chave_nf VARCHAR(44),
    status VARCHAR(30) NOT NULL DEFAULT 'RASCUNHO',
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_recebimentos_numero_empresa UNIQUE (empresa_id, numero),
    CONSTRAINT uq_recebimentos_chave_nf_empresa UNIQUE (empresa_id, chave_nf),
    CONSTRAINT ck_recebimentos_status CHECK (
        status IN (
            'RASCUNHO',
            'EM_CONFERENCIA',
            'CONFERIDO',
            'APROVADO',
            'DIVERGENCIA',
            'CANCELADO'
        )
    ),
    CONSTRAINT ck_recebimentos_chave_nf CHECK (
        chave_nf IS NULL OR char_length(chave_nf) = 44
    )
);

CREATE TABLE IF NOT EXISTS recebimentos_itens (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    recebimento_id BIGINT NOT NULL REFERENCES recebimentos(id),
    pedido_compra_item_id BIGINT NOT NULL REFERENCES pedidos_compra_itens(id),
    produto_id BIGINT,
    descricao_snapshot VARCHAR(255) NOT NULL,
    quantidade_pedida NUMERIC(18,4) NOT NULL,
    quantidade_recebida NUMERIC(18,4) NOT NULL,
    unidade VARCHAR(20) NOT NULL DEFAULT 'UN',
    preco_unitario NUMERIC(18,6) NOT NULL DEFAULT 0,
    lote VARCHAR(100),
    validade DATE,
    observacoes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_recebimento_item_quantidades CHECK (
        quantidade_pedida > 0 AND quantidade_recebida > 0
    ),
    CONSTRAINT ck_recebimento_item_preco CHECK (preco_unitario >= 0)
);

CREATE INDEX IF NOT EXISTS idx_recebimentos_empresa_status
    ON recebimentos (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_recebimentos_empresa_numero
    ON recebimentos (empresa_id, numero);

CREATE INDEX IF NOT EXISTS idx_recebimentos_pedido
    ON recebimentos (empresa_id, pedido_compra_id);

CREATE INDEX IF NOT EXISTS idx_recebimentos_nf
    ON recebimentos (empresa_id, numero_nf, serie_nf);

CREATE INDEX IF NOT EXISTS idx_recebimentos_itens_empresa
    ON recebimentos_itens (empresa_id, recebimento_id);

CREATE INDEX IF NOT EXISTS idx_recebimentos_itens_pedido
    ON recebimentos_itens (empresa_id, pedido_compra_item_id);
