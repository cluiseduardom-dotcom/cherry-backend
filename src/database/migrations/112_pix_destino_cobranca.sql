-- Pix do Mercado Pago para RECEBER fiado (Colheita) e parcelas do crediário.
--
-- A cobrança Pix passa a poder ter um "destino": em vez de entrar numa venda do PDV, o dinheiro quita um pagamento de fiado do
-- cliente ou (parte de) uma conta a receber. Quando o Mercado Pago confirma, o servidor aplica sozinho e UMA vez só.
--
-- * destino_tipo / destino_id: o que a cobrança quita ('fiado' → cliente_id; 'conta_receber' → contas_receber.id). Sem FK de
--   propósito (o destino é polimórfico); a empresa sempre é conferida junto, na aplicação, dentro do mesmo tenant.
-- * destino_aplicado_em: preenchido só depois que o lançamento/recebimento foi gravado. Cobrança paga que não pôde ser aplicada
--   (ex.: o saldo mudou) fica com destino_erro e continua em "Pix a devolver".
-- * Só acrescenta. Idempotente. Reversão manual no rodapé.

ALTER TABLE cobrancas_pagamento
    ADD COLUMN IF NOT EXISTS destino_tipo VARCHAR(20),
    ADD COLUMN IF NOT EXISTS destino_id INTEGER,
    ADD COLUMN IF NOT EXISTS destino_aplicado_em TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS destino_erro VARCHAR(200);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cobranca_destino') THEN
        ALTER TABLE cobrancas_pagamento
            ADD CONSTRAINT ck_cobranca_destino CHECK (
                (destino_tipo IS NULL AND destino_id IS NULL AND destino_aplicado_em IS NULL AND destino_erro IS NULL)
                OR (destino_tipo IN ('fiado', 'conta_receber') AND destino_id IS NOT NULL AND venda_id IS NULL)
            );
    END IF;
END $$;

-- Reversão manual (não executada pelo runner; só depois de reverter o código que lê as colunas):
--   ALTER TABLE cobrancas_pagamento DROP CONSTRAINT IF EXISTS ck_cobranca_destino;
--   ALTER TABLE cobrancas_pagamento DROP COLUMN IF EXISTS destino_tipo, DROP COLUMN IF EXISTS destino_id,
--       DROP COLUMN IF EXISTS destino_aplicado_em, DROP COLUMN IF EXISTS destino_erro;
