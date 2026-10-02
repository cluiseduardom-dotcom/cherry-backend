-- P0-06: núcleo financeiro de pagamentos, parcelas, recebimentos e estornos.
-- Mantém o modelo legado de vendas/contas a receber durante a transição.
-- Nenhum dado financeiro histórico é apagado ou reinterpretado nesta migration.

ALTER TABLE vendas
    ADD COLUMN IF NOT EXISTS subtotal NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS desconto NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS juros NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE contas_receber
    ALTER COLUMN valor TYPE NUMERIC(15,2);

CREATE TABLE IF NOT EXISTS pagamentos_venda (
    id SERIAL PRIMARY KEY,
    venda_id INTEGER NOT NULL REFERENCES vendas(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),

    forma_pagamento VARCHAR(20) NOT NULL
        CHECK (forma_pagamento IN ('pix','dinheiro','debito','credito','crediario')),

    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
    valor_recebido NUMERIC(15,2) CHECK (valor_recebido >= 0),
    troco NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (troco >= 0),

    numero_parcelas INTEGER NOT NULL DEFAULT 1
        CHECK (numero_parcelas >= 1),

    status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente','parcial','pago','estornado','cancelado')),

    origem VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (origem IN ('manual','gateway','tef')),

    provedor VARCHAR(50),
    transacao_externa_id VARCHAR(255),
    autorizacao VARCHAR(100),
    nsu VARCHAR(100),

    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    observacao TEXT,

    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_venda_venda
    ON pagamentos_venda(venda_id);

CREATE INDEX IF NOT EXISTS idx_pagamentos_venda_empresa
    ON pagamentos_venda(empresa_id);

CREATE INDEX IF NOT EXISTS idx_pagamentos_venda_status
    ON pagamentos_venda(status);

CREATE INDEX IF NOT EXISTS idx_pagamentos_venda_transacao
    ON pagamentos_venda(transacao_externa_id);

CREATE TABLE IF NOT EXISTS parcelas_pagamento (
    id SERIAL PRIMARY KEY,
    pagamento_id INTEGER NOT NULL REFERENCES pagamentos_venda(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),

    numero INTEGER NOT NULL CHECK (numero >= 1),
    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
    valor_principal NUMERIC(15,2) NOT NULL CHECK (valor_principal >= 0),
    juros NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (juros >= 0),
    desconto NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
    valor_pago NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (valor_pago >= 0),

    data_vencimento DATE NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente','parcial','recebida','atrasada','cancelada','estornada')),

    data_pagamento DATE,
    usuario_baixa_id INTEGER REFERENCES usuarios(id),

    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (pagamento_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_parcelas_pagamento
    ON parcelas_pagamento(pagamento_id);

CREATE INDEX IF NOT EXISTS idx_parcelas_empresa
    ON parcelas_pagamento(empresa_id);

CREATE INDEX IF NOT EXISTS idx_parcelas_vencimento
    ON parcelas_pagamento(data_vencimento);

CREATE INDEX IF NOT EXISTS idx_parcelas_status
    ON parcelas_pagamento(status);

ALTER TABLE contas_receber
    ADD COLUMN IF NOT EXISTS parcela_id INTEGER
        REFERENCES parcelas_pagamento(id);

ALTER TABLE contas_receber
    DROP CONSTRAINT IF EXISTS contas_receber_venda_id_key;

CREATE INDEX IF NOT EXISTS idx_contas_receber_parcela
    ON contas_receber(parcela_id);

CREATE TABLE IF NOT EXISTS recebimentos_conta (
    id SERIAL PRIMARY KEY,
    parcela_id INTEGER NOT NULL REFERENCES parcelas_pagamento(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),

    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),

    forma_pagamento VARCHAR(20) NOT NULL
        CHECK (forma_pagamento IN ('pix','dinheiro','debito','credito')),

    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    data_recebimento TIMESTAMP NOT NULL DEFAULT NOW(),
    observacao TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recebimentos_parcela
    ON recebimentos_conta(parcela_id);

CREATE INDEX IF NOT EXISTS idx_recebimentos_empresa
    ON recebimentos_conta(empresa_id);

CREATE INDEX IF NOT EXISTS idx_recebimentos_data
    ON recebimentos_conta(data_recebimento);

CREATE TABLE IF NOT EXISTS estornos_pagamento (
    id SERIAL PRIMARY KEY,
    pagamento_id INTEGER NOT NULL REFERENCES pagamentos_venda(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),

    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
    motivo TEXT NOT NULL,

    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_estornos_pagamento
    ON estornos_pagamento(pagamento_id);

CREATE INDEX IF NOT EXISTS idx_estornos_empresa
    ON estornos_pagamento(empresa_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),

    chave VARCHAR(255) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,

    recurso_id INTEGER,
    resposta JSONB,

    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (empresa_id, chave, endpoint)
);
