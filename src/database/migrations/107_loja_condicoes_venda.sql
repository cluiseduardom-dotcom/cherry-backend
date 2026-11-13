-- Loja online — condições de venda que a loja assume: frete grátis acima de um valor, garantia e embalagem de presente.
--
-- * frete_gratis_acima: valor mínimo do subtotal (R$) para frete grátis. NULL = sem frete grátis (frete segue "a combinar").
-- * garantia_texto / embalagem_presente_texto: textos da loja. NULL = a loja não mostra nada (nada é preenchido pelo sistema).
-- * O pedido grava o frete (0) no momento da compra: mudar o valor depois não altera pedidos já feitos.
-- * Só acrescenta colunas. Idempotente. Reversão manual no rodapé.

ALTER TABLE loja_institucional
    ADD COLUMN IF NOT EXISTS frete_gratis_acima       NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS garantia_texto           VARCHAR(300),
    ADD COLUMN IF NOT EXISTS embalagem_presente_texto VARCHAR(200);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loja_institucional_frete_gratis_chk') THEN
        ALTER TABLE loja_institucional
            ADD CONSTRAINT loja_institucional_frete_gratis_chk CHECK (frete_gratis_acima IS NULL OR frete_gratis_acima > 0);
    END IF;
END $$;

-- Reversão manual (não executada pelo runner; só depois de reverter o código que lê as colunas):
--   ALTER TABLE loja_institucional DROP CONSTRAINT IF EXISTS loja_institucional_frete_gratis_chk;
--   ALTER TABLE loja_institucional
--       DROP COLUMN IF EXISTS frete_gratis_acima, DROP COLUMN IF EXISTS garantia_texto, DROP COLUMN IF EXISTS embalagem_presente_texto;
