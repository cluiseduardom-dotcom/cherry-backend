-- Loja online — pedido de presente: a cliente marca "é presente" no checkout e pode escrever a mensagem do cartão.
--
-- * presente: a equipe embala para presente (a loja só oferece a opção se tiver a embalagem preenchida no ERP).
-- * mensagem_cartao: texto puro de até 200 caracteres; só existe se for presente. Pode conter nome de terceiro, por isso é
--   dado pessoal: a anonimização por prazo (LGPD) também a apaga.
-- * Só acrescenta colunas. Idempotente. Reversão manual no rodapé.

ALTER TABLE pedidos_loja
    ADD COLUMN IF NOT EXISTS presente        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS mensagem_cartao VARCHAR(200);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_loja_cartao_chk') THEN
        ALTER TABLE pedidos_loja
            ADD CONSTRAINT pedidos_loja_cartao_chk CHECK (mensagem_cartao IS NULL OR presente);
    END IF;
END $$;

-- Reversão manual (não executada pelo runner; só depois de reverter o código que lê as colunas):
--   ALTER TABLE pedidos_loja DROP CONSTRAINT IF EXISTS pedidos_loja_cartao_chk;
--   ALTER TABLE pedidos_loja DROP COLUMN IF EXISTS presente, DROP COLUMN IF EXISTS mensagem_cartao;
