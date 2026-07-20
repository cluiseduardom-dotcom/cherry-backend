-- Adds SKU/catalog fields to produtos: sku, descricao, categoria, estoque_atual,
-- estoque_minimo, ativo. Existing columns (nome, preco_venda, custo) are untouched.
-- margem is derived at read time, not stored.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS sku VARCHAR(50) UNIQUE;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria VARCHAR(100);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_atual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_minimo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
