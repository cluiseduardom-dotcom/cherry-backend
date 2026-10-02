CREATE TABLE IF NOT EXISTS transacoes_pagamento (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresas(id),
    tipo VARCHAR(30) NOT NULL,
    forma_pagamento VARCHAR(30) NOT NULL,
    origem VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    provedor VARCHAR(100),
    valor NUMERIC(18,2) NOT NULL,
    taxa NUMERIC(18,2) NOT NULL DEFAULT 0,
    valor_liquido NUMERIC(18,2) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
    transacao_externa_id VARCHAR(255),
    autorizacao VARCHAR(100),
    nsu VARCHAR(100),
    tid VARCHAR(100),
    data_autorizacao TIMESTAMPTZ,
    data_confirmacao TIMESTAMPTZ,
    observacao TEXT,
    usuario_id BIGINT REFERENCES usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_transacao_pagamento_tipo
        CHECK (tipo IN ('PAGAMENTO','RECEBIMENTO','ESTORNO')),
    CONSTRAINT ck_transacao_pagamento_forma
        CHECK (forma_pagamento IN (
            'PIX','DINHEIRO','DEBITO','CREDITO','BOLETO',
            'TRANSFERENCIA','OUTRO'
        )),
    CONSTRAINT ck_transacao_pagamento_origem
        CHECK (origem IN ('MANUAL','GATEWAY','TEF','OPEN_FINANCE','API_BANCO')),
    CONSTRAINT ck_transacao_pagamento_status
        CHECK (status IN (
            'PENDENTE','AUTORIZADA','PROCESSANDO','CONFIRMADA',
            'RECUSADA','CANCELADA','ESTORNADA','CONCILIADA'
        )),
    CONSTRAINT ck_transacao_pagamento_valor CHECK (valor > 0),
    CONSTRAINT ck_transacao_pagamento_taxa CHECK (taxa >= 0),
    CONSTRAINT ck_transacao_pagamento_liquido CHECK (valor_liquido >= 0)
);

CREATE INDEX IF NOT EXISTS idx_transacoes_pagamento_empresa_status
    ON transacoes_pagamento (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_transacoes_pagamento_externa
    ON transacoes_pagamento (empresa_id, transacao_externa_id);

CREATE INDEX IF NOT EXISTS idx_transacoes_pagamento_tipo
    ON transacoes_pagamento (empresa_id, tipo);

CREATE TABLE IF NOT EXISTS transacoes_pagamento_parcelas (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresas(id),
    transacao_pagamento_id BIGINT NOT NULL REFERENCES transacoes_pagamento(id),
    numero INTEGER NOT NULL,
    valor NUMERIC(18,2) NOT NULL,
    data_prevista TIMESTAMPTZ,
    data_liquidacao TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDENTE',
    CONSTRAINT uq_pagamento_parcela UNIQUE (transacao_pagamento_id, numero),
    CONSTRAINT ck_pagamento_parcela_numero CHECK (numero > 0),
    CONSTRAINT ck_pagamento_parcela_valor CHECK (valor > 0),
    CONSTRAINT ck_pagamento_parcela_status CHECK (
        status IN ('PENDENTE','LIQUIDADA','CANCELADA','ESTORNADA')
    )
);

CREATE INDEX IF NOT EXISTS idx_pagamento_parcelas_empresa_status
    ON transacoes_pagamento_parcelas (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_pagamento_parcelas_transacao
    ON transacoes_pagamento_parcelas (transacao_pagamento_id);
