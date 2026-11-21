-- 128: venda por peso/volume (adega, lanchonete, confeitaria).
--
-- Decisão do PO: o estoque segue em inteiros na unidade-base (G, ML) e o PDV digita kg/L (a tela converte). O preço de venda do
-- produto passa a valer para `preco_base_quantidade` unidades-base: 1 (padrão, tudo como sempre foi), 100 ou 1000 (só G e ML).
-- Ex.: queijo a R$ 45,00 o kg = preco_venda 45,00 com preco_base_quantidade 1000.
--
-- O item da venda congela o preço POR UNIDADE-BASE (R$ 0,045/g), por isso `itens_venda.preco_unitario` ganha casas decimais:
-- com isso todos os relatórios que somam quantidade × preço seguem corretos sem mudança. O total do item é arredondado ao centavo.
-- Sem alteração de dado existente: todo produto atual fica com base 1. Idempotente.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_base_quantidade INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_produtos_preco_base_quantidade') THEN
        ALTER TABLE produtos ADD CONSTRAINT chk_produtos_preco_base_quantidade
            CHECK (preco_base_quantidade IN (1, 100, 1000) AND (preco_base_quantidade = 1 OR unidade IN ('G', 'ML')));
    END IF;
END $$;

ALTER TABLE itens_venda ALTER COLUMN preco_unitario TYPE NUMERIC(14,6);

-- Reversão manual (não executada pelo runner; só se nenhum produto usar base > 1):
--   ALTER TABLE itens_venda ALTER COLUMN preco_unitario TYPE NUMERIC(10,2);
--   ALTER TABLE produtos DROP CONSTRAINT chk_produtos_preco_base_quantidade;
--   ALTER TABLE produtos DROP COLUMN preco_base_quantidade;
