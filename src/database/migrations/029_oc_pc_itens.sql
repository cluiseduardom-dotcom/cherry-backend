CREATE TABLE IF NOT EXISTS oc_pc_itens (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL,
    ordem_compra_item_id BIGINT NOT NULL REFERENCES ordens_compra_itens(id),
    pedido_compra_item_id BIGINT NOT NULL REFERENCES pedidos_compra_itens(id),
    quantidade_vinculada NUMERIC(18,4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_oc_pc_item_vinculo
        UNIQUE (empresa_id, ordem_compra_item_id, pedido_compra_item_id),
    CONSTRAINT ck_oc_pc_quantidade CHECK (quantidade_vinculada > 0)
);

CREATE INDEX IF NOT EXISTS idx_oc_pc_empresa_oc_item
    ON oc_pc_itens (empresa_id, ordem_compra_item_id);

CREATE INDEX IF NOT EXISTS idx_oc_pc_empresa_pc_item
    ON oc_pc_itens (empresa_id, pedido_compra_item_id);

CREATE INDEX IF NOT EXISTS idx_oc_pc_empresa
    ON oc_pc_itens (empresa_id);
