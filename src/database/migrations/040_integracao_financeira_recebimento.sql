-- Integração financeira do recebimento aprovado.
-- A conta a pagar continua sendo a obrigação financeira vigente no VERTUMNO.
-- O vínculo ao recebimento evita duplicidade e preserva a origem da obrigação.
ALTER TABLE contas_pagar
    ADD COLUMN IF NOT EXISTS recebimento_id BIGINT REFERENCES recebimentos(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_pagar_recebimento_empresa
    ON contas_pagar (empresa_id, recebimento_id)
    WHERE recebimento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_recebimento_empresa
    ON contas_pagar (empresa_id, recebimento_id);
