CREATE TABLE IF NOT EXISTS movimentos_bancarios (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresas(id),
    conta_bancaria_id BIGINT NOT NULL REFERENCES contas_bancarias(id),
    tipo VARCHAR(20) NOT NULL,
    origem VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    valor NUMERIC(18,2) NOT NULL,
    data_movimento TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    descricao VARCHAR(255),
    referencia_externa VARCHAR(255),
    liquidacao_pagamento_id BIGINT REFERENCES liquidacoes_pagamento(id),
    transacao_pagamento_id BIGINT REFERENCES transacoes_pagamento(id),
    conciliado BOOLEAN NOT NULL DEFAULT FALSE,
    observacao TEXT,
    usuario_id BIGINT REFERENCES usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_mov_banc_tipo CHECK (tipo IN ('ENTRADA','SAIDA')),
    CONSTRAINT ck_mov_banc_origem CHECK (
        origem IN ('MANUAL','PAGAMENTO','RECEBIMENTO','TRANSFERENCIA','OPEN_FINANCE','API_BANCO','AJUSTE')
    ),
    CONSTRAINT ck_mov_banc_valor CHECK (valor > 0)
);

CREATE INDEX IF NOT EXISTS idx_mov_banc_empresa_conta_data
    ON movimentos_bancarios (empresa_id, conta_bancaria_id, data_movimento);

CREATE INDEX IF NOT EXISTS idx_mov_banc_empresa_conciliado
    ON movimentos_bancarios (empresa_id, conciliado);

CREATE INDEX IF NOT EXISTS idx_mov_banc_liquidacao
    ON movimentos_bancarios (empresa_id, liquidacao_pagamento_id);

CREATE INDEX IF NOT EXISTS idx_mov_banc_transacao
    ON movimentos_bancarios (empresa_id, transacao_pagamento_id);
