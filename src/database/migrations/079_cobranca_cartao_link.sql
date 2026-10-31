-- Link de pagamento de cartão (Mercado Pago Checkout Pro) na mesma tabela de cobranças do Pix.
--
-- * metodo passa a aceitar 'cartao_link'. O link é criado ANTES do pagamento existir: o id do pagamento
--   (id_externo) só é conhecido depois que o cliente paga, quando a confirmação chega por webhook ou
--   consulta por external_reference (= codigo).
-- * preferencia_id / link_url: preferência do Checkout Pro e o endereço que o cliente abre.
-- * tipo_cartao / parcelas: preenchidos a partir do PAGAMENTO confirmado no Mercado Pago, nunca digitados.
-- * parcelas_maximas: teto oferecido no link.
--
-- Tudo aditivo; cobranças Pix existentes não mudam (as colunas novas ficam nulas).

ALTER TABLE cobrancas_pagamento DROP CONSTRAINT IF EXISTS cobrancas_pagamento_metodo_check;

ALTER TABLE cobrancas_pagamento
    ADD CONSTRAINT ck_cobranca_metodo CHECK (metodo IN ('pix', 'cartao_link'));

ALTER TABLE cobrancas_pagamento
    ADD COLUMN IF NOT EXISTS preferencia_id VARCHAR(80),
    ADD COLUMN IF NOT EXISTS link_url TEXT,
    ADD COLUMN IF NOT EXISTS tipo_cartao VARCHAR(10),
    ADD COLUMN IF NOT EXISTS parcelas SMALLINT,
    ADD COLUMN IF NOT EXISTS parcelas_maximas SMALLINT;

ALTER TABLE cobrancas_pagamento
    ADD CONSTRAINT ck_cobranca_tipo_cartao CHECK (tipo_cartao IS NULL OR tipo_cartao IN ('credito', 'debito')),
    ADD CONSTRAINT ck_cobranca_parcelas CHECK (parcelas IS NULL OR parcelas BETWEEN 1 AND 24),
    ADD CONSTRAINT ck_cobranca_parcelas_maximas CHECK (parcelas_maximas IS NULL OR parcelas_maximas BETWEEN 1 AND 24),
    -- Pix nunca carrega dados de cartão; cartão nunca nasce com QR de Pix.
    ADD CONSTRAINT ck_cobranca_campos_por_metodo CHECK (
        (metodo = 'pix' AND tipo_cartao IS NULL AND parcelas IS NULL AND preferencia_id IS NULL AND link_url IS NULL)
        OR (metodo = 'cartao_link' AND qr_code IS NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_preferencia
    ON cobrancas_pagamento (provedor, preferencia_id) WHERE preferencia_id IS NOT NULL;
