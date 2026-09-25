CREATE TABLE IF NOT EXISTS contas_bancarias (
    id BIGSERIAL PRIMARY KEY,
    empresa_id BIGINT NOT NULL REFERENCES empresas(id),
    filial_id BIGINT,
    nome VARCHAR(150) NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    origem VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    banco_codigo VARCHAR(10),
    instituicao_nome VARCHAR(150),
    agencia VARCHAR(30),
    conta VARCHAR(50),
    digito VARCHAR(10),
    moeda VARCHAR(3) NOT NULL DEFAULT 'BRL',
    saldo_inicial NUMERIC(18,2) NOT NULL DEFAULT 0,
    data_saldo_inicial DATE,
    principal BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ATIVA',
    provedor VARCHAR(100),
    conexao_externa_id VARCHAR(255),
    conta_externa_id VARCHAR(255),
    ultima_sincronizacao_em TIMESTAMPTZ,
    observacao TEXT,
    usuario_id BIGINT REFERENCES usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_contas_bancarias_tipo CHECK (
        tipo IN ('CAIXA','CONTA_CORRENTE','CONTA_POUPANCA','CONTA_PAGAMENTO')
    ),
    CONSTRAINT ck_contas_bancarias_origem CHECK (
        origem IN ('MANUAL','OPEN_FINANCE','API_BANCO')
    ),
    CONSTRAINT ck_contas_bancarias_status CHECK (
        status IN ('ATIVA','BLOQUEADA','INATIVA')
    ),
    CONSTRAINT ck_contas_bancarias_saldo_inicial CHECK (saldo_inicial IS NOT NULL),
    CONSTRAINT uq_contas_bancarias_conta_externa
        UNIQUE (empresa_id, provedor, conta_externa_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_bancarias_principal
    ON contas_bancarias (empresa_id)
    WHERE principal = TRUE AND status <> 'INATIVA';

CREATE INDEX IF NOT EXISTS idx_contas_bancarias_empresa_status
    ON contas_bancarias (empresa_id, status);

CREATE INDEX IF NOT EXISTS idx_contas_bancarias_empresa_tipo
    ON contas_bancarias (empresa_id, tipo);

CREATE INDEX IF NOT EXISTS idx_contas_bancarias_empresa_filial
    ON contas_bancarias (empresa_id, filial_id);

CREATE INDEX IF NOT EXISTS idx_contas_bancarias_conexao_externa
    ON contas_bancarias (empresa_id, provedor, conexao_externa_id);
