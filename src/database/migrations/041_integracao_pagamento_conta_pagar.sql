ALTER TABLE contas_pagar
    ADD COLUMN IF NOT EXISTS transacao_pagamento_id BIGINT REFERENCES transacoes_pagamento(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_pagar_transacao_pagamento_empresa
    ON contas_pagar (empresa_id, transacao_pagamento_id)
    WHERE transacao_pagamento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contas_pagar_transacao_pagamento_empresa
    ON contas_pagar (empresa_id, transacao_pagamento_id);