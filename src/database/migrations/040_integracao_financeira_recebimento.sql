-- Integração financeira do recebimento aprovado.
-- Uma conta a pagar passa a poder apontar para o recebimento que originou
-- a obrigação, sem duplicar a estrutura financeira existente.
ALTER TABLE contas_pagar
    ADD COLUMN IF NOT EXISTS recebimento_id BIGINT REFERENCES recebimentos(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_pagar_recebimento_empresa
    ON contas_pagar (empresa_id, recebimento_id)
    WHERE recebimento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_recebimento_empresa
    ON contas_pagar (empresa_id, recebimento_id);
