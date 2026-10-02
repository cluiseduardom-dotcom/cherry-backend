CREATE TABLE IF NOT EXISTS liquidacoes_pagamento (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresas(id),
    transacao_pagamento_id BIGINT NOT NULL REFERENCES transacoes_pagamento(id),
    transacao_pagamento_parcela_id BIGINT REFERENCES transacoes_pagamento_parcelas(id),
    tipo VARCHAR(20) NOT NULL,
    valor_bruto NUMERIC(18,2) NOT NULL,
    taxa NUMERIC(18,2) NOT NULL DEFAULT 0,
    valor_liquido NUMERIC(18,2) NOT NULL,
    data_prevista DATE,
    data_liquidacao TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    referencia_externa VARCHAR(255),
    observacao TEXT,
    usuario_id BIGINT REFERENCES usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_liq_tipo CHECK (tipo IN ('PAGAMENTO','RECEBIMENTO')),
    CONSTRAINT ck_liq_valor_bruto CHECK (valor_bruto > 0),
    CONSTRAINT ck_liq_taxa CHECK (taxa >= 0 AND taxa <= valor_bruto),
    CONSTRAINT ck_liq_valor_liquido CHECK (valor_liquido >= 0),
    CONSTRAINT ck_liq_status CHECK (status IN ('PENDENTE','PREVISTA','LIQUIDADA','CANCELADA','ESTORNADA')),
    CONSTRAINT ck_liq_datas CHECK (data_liquidacao IS NULL OR data_prevista IS NULL OR data_liquidacao::date >= data_prevista)
);

CREATE INDEX IF NOT EXISTS idx_liquidacoes_pagamento_empresa_status
    ON liquidacoes_pagamento (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_liquidacoes_pagamento_transacao
    ON liquidacoes_pagamento (empresa_id, transacao_pagamento_id);

CREATE INDEX IF NOT EXISTS idx_liquidacoes_pagamento_prevista
    ON liquidacoes_pagamento (empresa_id, data_prevista);

CREATE INDEX IF NOT EXISTS idx_liquidacoes_pagamento_parcela
    ON liquidacoes_pagamento (empresa_id, transacao_pagamento_parcela_id);
