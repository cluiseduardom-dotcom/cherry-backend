-- Total efetivamente pago pelo cliente no link de cartão (valor da compra + juros do parcelamento).
--
-- O Mercado Pago cobra o juro do parcelamento do COMPRADOR: o `transaction_amount` continua igual ao valor da
-- cobrança (é ele que a confirmação compara), e o total com juros vem em `transaction_details.total_paid_amount`.
-- Guardamos esse total só para informar; nunca entra no valor da venda, em caixa ou em financeiro.
-- Anulável: Pix, cobranças antigas e pagamentos em que o Mercado Pago não informou o total ficam nulos.
--
-- Aditiva e idempotente. Reversão manual: ALTER TABLE cobrancas_pagamento DROP COLUMN valor_total_pago;

ALTER TABLE cobrancas_pagamento ADD COLUMN IF NOT EXISTS valor_total_pago NUMERIC(12, 2);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cobranca_total_pago') THEN
        ALTER TABLE cobrancas_pagamento
            ADD CONSTRAINT ck_cobranca_total_pago CHECK (valor_total_pago IS NULL OR (metodo = 'cartao_link' AND valor_total_pago >= valor));
    END IF;
END $$;
