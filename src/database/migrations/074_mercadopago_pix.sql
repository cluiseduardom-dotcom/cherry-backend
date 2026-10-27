-- Integração Mercado Pago (marketplace): conexão da loja por OAuth e cobrança Pix.
--
-- * empresa_mercadopago: UMA conexão por empresa. Os tokens ficam CRIPTOGRAFADOS (AES-256-GCM,
--   chave em variável de ambiente); nunca em texto puro e nunca devolvidos por rota alguma.
-- * mp_oauth_estados: parâmetro `state` do OAuth, de uso único e curta duração, amarrado à
--   empresa e ao usuário que iniciou (o retorno do Mercado Pago chega sem JWT).
-- * cobrancas_pagamento: cobrança criada ANTES de existir a venda (o PDV só cria a venda com os
--   pagamentos já confirmados). Vira "usada" quando uma venda a consome (PR seguinte).
--
-- Tudo aditivo. Sem as variáveis MP_* a integração fica desligada e nada muda para as lojas.

CREATE TABLE IF NOT EXISTS empresa_mercadopago (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL UNIQUE REFERENCES empresas(id),
    mp_user_id VARCHAR(40) NOT NULL,
    access_token_cifrado TEXT,
    refresh_token_cifrado TEXT,
    token_expira_em TIMESTAMPTZ,
    ativo BOOLEAN NOT NULL DEFAULT true,
    conectado_por INTEGER REFERENCES usuarios(id),
    conectado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_empresa_mp_tokens CHECK (ativo = false OR access_token_cifrado IS NOT NULL)
);

-- Uma conta Mercado Pago só pode estar ligada a uma empresa ativa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresa_mp_user_ativo
    ON empresa_mercadopago (mp_user_id) WHERE ativo;

CREATE TABLE IF NOT EXISTS mp_oauth_estados (
    state VARCHAR(64) PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expira_em TIMESTAMPTZ NOT NULL,
    usado_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mp_oauth_estados_expira ON mp_oauth_estados (expira_em);

CREATE TABLE IF NOT EXISTS cobrancas_pagamento (
    id SERIAL PRIMARY KEY,
    -- Identificador público (UUID): vai ao Mercado Pago como external_reference e chave de idempotência.
    codigo UUID NOT NULL UNIQUE,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    provedor VARCHAR(30) NOT NULL DEFAULT 'mercadopago' CHECK (provedor IN ('mercadopago')),
    metodo VARCHAR(20) NOT NULL DEFAULT 'pix' CHECK (metodo IN ('pix')),

    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
    -- Comissão da plataforma enviada como application_fee (valor em reais, calculada pela regra da taxa).
    taxa_plataforma NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (taxa_plataforma >= 0 AND taxa_plataforma < valor),

    status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente','pago','cancelado','estornado','falhou')),

    id_externo VARCHAR(64),
    qr_code TEXT,
    qr_code_base64 TEXT,
    ticket_url TEXT,
    expira_em TIMESTAMPTZ,

    criado_por INTEGER NOT NULL REFERENCES usuarios(id),
    -- Preenchidos quando uma venda consome a cobrança (PR seguinte).
    venda_id INTEGER REFERENCES vendas(id),
    usada_em TIMESTAMPTZ,

    consultado_em TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_cobranca_usada CHECK ((venda_id IS NULL) = (usada_em IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_id_externo
    ON cobrancas_pagamento (provedor, id_externo) WHERE id_externo IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cobrancas_empresa_criado
    ON cobrancas_pagamento (empresa_id, criado_em DESC);
