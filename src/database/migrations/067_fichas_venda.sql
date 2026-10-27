-- Ficha de venda do SKU (#150, fatia 1a): o que acompanha UMA unidade vendida de um produto acabado
-- (embalagem, tag, caixinha, saquinho...). É a base do custo total do SKU e, na fatia seguinte, da baixa
-- automática de insumos a cada venda. NÃO é a ficha técnica de produção (fichas_tecnicas, migration 013):
-- aquela transforma insumos em produto acabado; esta descreve o que sai do estoque quando o produto é vendido.
--
-- Versionada como as demais: nova versão = INSERT com vigente = true, derrubando a anterior na mesma transação
-- (índice único parcial). Vendas antigas guardarão o próprio snapshot (fatia 1b), então versões antigas não mudam.
-- Quantidade INTEGER: estoque e movimentações do sistema são inteiros.
-- FKs compostas com empresa_id: ficha, item e insumo são sempre da mesma empresa (o banco recusa mistura).
-- Migration só aditiva.

CREATE TABLE IF NOT EXISTS fichas_venda (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL,
    vigente BOOLEAN NOT NULL DEFAULT true,
    criado_por INTEGER,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fichas_venda_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
    CONSTRAINT fichas_venda_criado_por_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT fichas_venda_id_empresa_uk UNIQUE (id, empresa_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_venda_vigente_unica
    ON fichas_venda (empresa_id, produto_id) WHERE vigente = true;
CREATE INDEX IF NOT EXISTS idx_fichas_venda_produto ON fichas_venda (empresa_id, produto_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS itens_ficha_venda (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    ficha_venda_id INTEGER NOT NULL,
    insumo_produto_id INTEGER NOT NULL,
    quantidade INTEGER NOT NULL,
    CONSTRAINT itens_ficha_venda_ficha_fk FOREIGN KEY (ficha_venda_id, empresa_id) REFERENCES fichas_venda (id, empresa_id),
    CONSTRAINT itens_ficha_venda_insumo_fk FOREIGN KEY (insumo_produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
    CONSTRAINT itens_ficha_venda_quantidade_chk CHECK (quantidade > 0),
    CONSTRAINT itens_ficha_venda_insumo_uk UNIQUE (ficha_venda_id, insumo_produto_id)
);

CREATE INDEX IF NOT EXISTS idx_itens_ficha_venda_insumo ON itens_ficha_venda (empresa_id, insumo_produto_id);

-- Reversão manual: DROP TABLE itens_ficha_venda; DROP TABLE fichas_venda;
