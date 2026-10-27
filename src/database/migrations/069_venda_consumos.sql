-- Consumo automático de insumos por venda (#150, fatia 1b). A cada venda, o que a ficha de venda vigente
-- (migration 067) manda sair do estoque Central é gravado AQUI como snapshot: uma linha por insumo, com a
-- quantidade prevista, a quantidade realmente baixada e o custo unitário da época. Mudar a ficha depois não
-- altera vendas antigas; o custo da venda passa a usar o consumo real (snapshot), não a ficha atual.
--
-- quantidade_baixada < quantidade_prevista = pendência: o insumo não tinha saldo no Central na hora da venda.
-- A venda NÃO é bloqueada por falta de embalagem; baixa-se o que existe e a falta aparece no sino.
-- Insumo só sai do Central (decisão do PO), de qualquer local de onde saiu o produto vendido.
-- devolvido_em: preenchido ao cancelar a venda (o baixado volta ao Central por movimentação auditada).
-- Histórico nunca é apagado. FKs compostas com empresa_id: venda, insumo e local são sempre da mesma empresa.
-- Migration só aditiva. Reversão manual: DROP TABLE venda_consumos.

CREATE TABLE IF NOT EXISTS venda_consumos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    venda_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    ficha_venda_id INTEGER,
    local_id INTEGER NOT NULL,
    origem VARCHAR(20) NOT NULL DEFAULT 'ficha',
    quantidade_prevista INTEGER NOT NULL,
    quantidade_baixada INTEGER NOT NULL DEFAULT 0,
    custo_unitario NUMERIC(10, 2) NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    devolvido_em TIMESTAMPTZ,
    CONSTRAINT venda_consumos_venda_fk FOREIGN KEY (venda_id, empresa_id) REFERENCES vendas (id, empresa_id),
    CONSTRAINT venda_consumos_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
    CONSTRAINT venda_consumos_ficha_fk FOREIGN KEY (ficha_venda_id, empresa_id) REFERENCES fichas_venda (id, empresa_id),
    CONSTRAINT venda_consumos_local_fk FOREIGN KEY (local_id, empresa_id) REFERENCES locais_estoque (id, empresa_id),
    CONSTRAINT venda_consumos_origem_chk CHECK (origem IN ('ficha')),
    CONSTRAINT venda_consumos_quantidades_chk CHECK (
        quantidade_prevista > 0 AND quantidade_baixada >= 0 AND quantidade_baixada <= quantidade_prevista
    )
);

CREATE INDEX IF NOT EXISTS idx_venda_consumos_venda ON venda_consumos (empresa_id, venda_id);
CREATE INDEX IF NOT EXISTS idx_venda_consumos_produto ON venda_consumos (empresa_id, produto_id);
-- Pendências abertas (sino): só linhas com falta ainda não devolvidas.
CREATE INDEX IF NOT EXISTS idx_venda_consumos_pendentes
    ON venda_consumos (empresa_id, produto_id)
    WHERE quantidade_baixada < quantidade_prevista AND devolvido_em IS NULL;
