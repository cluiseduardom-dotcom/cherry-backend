-- Painel GiroNex: operadores da plataforma separados dos usuários das lojas.
--
-- * plataforma_operadores: quem opera a plataforma (planos, taxas, identidade, criação de empresas).
--   SEM empresa_id (exceção deliberada, como planos_comerciais): um operador não é usuário de loja, e uma
--   senha de loja nunca abre o painel (nem o contrário). Verificação em duas etapas (TOTP) obrigatória:
--   o segredo fica CIFRADO (AES-256-GCM, chave PAINEL_ENC_KEY do ambiente, nunca no banco).
-- * plataforma_eventos: trilha só-inserção (UPDATE/DELETE recusados pelo banco) de tudo que o painel faz.
--
-- Aditiva e idempotente. Reversão manual (sem eventos a preservar):
--   DROP TABLE IF EXISTS plataforma_eventos; DROP TABLE IF EXISTS plataforma_operadores;
--   DROP FUNCTION IF EXISTS plataforma_eventos_imutavel();

CREATE TABLE IF NOT EXISTS plataforma_operadores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    senha VARCHAR(255) NOT NULL,
    senha_temporaria BOOLEAN NOT NULL DEFAULT true,
    totp_segredo TEXT,
    totp_ativo BOOLEAN NOT NULL DEFAULT false,
    -- Último passo TOTP aceito: o mesmo código (30 s) não serve duas vezes.
    totp_ultimo_passo BIGINT,
    ativo BOOLEAN NOT NULL DEFAULT true,
    token_version INTEGER NOT NULL DEFAULT 0,
    ultimo_acesso_em TIMESTAMP,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT plataforma_operadores_email_minusculo_chk CHECK (email = lower(email)),
    CONSTRAINT plataforma_operadores_totp_chk CHECK (totp_ativo = false OR totp_segredo IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plataforma_operadores_email ON plataforma_operadores (email);

CREATE TABLE IF NOT EXISTS plataforma_eventos (
    id SERIAL PRIMARY KEY,
    operador_id INTEGER REFERENCES plataforma_operadores (id),
    acao VARCHAR(60) NOT NULL,
    alvo_empresa_id INTEGER REFERENCES empresas (id),
    detalhe JSONB,
    ip VARCHAR(64),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plataforma_eventos_data ON plataforma_eventos (criado_em DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_plataforma_eventos_empresa ON plataforma_eventos (alvo_empresa_id, criado_em DESC);

-- Imutável, no mesmo padrão de usuarios_eventos (só a limpeza dos testes de integração passa).
CREATE OR REPLACE FUNCTION plataforma_eventos_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'plataforma_eventos é imutável (% recusado)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plataforma_eventos_imutavel ON plataforma_eventos;
CREATE TRIGGER trg_plataforma_eventos_imutavel
    BEFORE UPDATE OR DELETE ON plataforma_eventos
    FOR EACH ROW EXECUTE FUNCTION plataforma_eventos_imutavel();
