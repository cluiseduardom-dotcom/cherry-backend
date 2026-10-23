-- Comissão de vendedor: percentual por vendedor (com padrão da empresa) e
-- comissão congelada POR VENDA.
--
-- comissao_percentuais: regra vigente, por tenant.
--   usuario_id NULL     -> padrão da empresa (vale para quem não tem percentual próprio)
--   usuario_id preenchido -> percentual daquele vendedor; 0 desliga a comissão dele
--   (o percentual próprio, inclusive 0, prevalece sobre o padrão).
--
-- comissoes_venda: UMA linha por venda finalizada, gravada na mesma transação da
-- venda (vendasRepository.criar), no mesmo padrão de taxas_venda. percentual e
-- base_calculo são o CONGELAMENTO da regra aplicada: mudar o percentual depois não
-- altera comissões já apuradas. Vendas anteriores a esta migration não têm
-- comissão (sem backfill).
--
-- A comissão NASCE 'pendente' e só vale conforme o pagamento é registrado:
-- valor_liberado cresce proporcionalmente ao que foi pago (parcela a parcela) e o
-- status acompanha ('pendente' -> 'parcial' -> 'liberada'). Dinheiro recebido pelo
-- vendedor só conta depois que um gerente/admin confirma o repasse (comissao_repasses).
--
-- Não apagar linhas de comissão: o cancelamento da venda marca status = 'estornada'.
-- Todo movimento (apuração, liberação, redução, estorno) fica em comissoes_eventos,
-- insert-only.
--
-- Migration só aditiva (CREATE ... IF NOT EXISTS): segura para reexecução e não
-- altera tabelas existentes.

CREATE TABLE IF NOT EXISTS comissao_percentuais (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    usuario_id INTEGER REFERENCES usuarios(id),
    percentual NUMERIC(7,4) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
    atualizado_por INTEGER REFERENCES usuarios(id),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Um percentual por vendedor e um padrão por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comissao_percentual_usuario
    ON comissao_percentuais (empresa_id, usuario_id)
    WHERE usuario_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_comissao_percentual_padrao
    ON comissao_percentuais (empresa_id)
    WHERE usuario_id IS NULL;

CREATE TABLE IF NOT EXISTS comissoes_venda (
    id SERIAL PRIMARY KEY,
    venda_id INTEGER NOT NULL UNIQUE REFERENCES vendas(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),

    percentual NUMERIC(7,4) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),

    -- subtotal - desconto da venda (sem juros do crediário): o juro não é receita de venda.
    base_calculo NUMERIC(15,2) NOT NULL CHECK (base_calculo >= 0),
    valor NUMERIC(15,2) NOT NULL CHECK (valor >= 0),

    -- Parte da comissão já liberada pelo pagamento. 0 <= valor_liberado <= valor.
    valor_liberado NUMERIC(15,2) NOT NULL DEFAULT 0,

    status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente', 'parcial', 'liberada', 'estornada')),

    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    estornado_em TIMESTAMP,

    CONSTRAINT ck_comissao_valor_ate_base CHECK (valor <= base_calculo),
    CONSTRAINT ck_comissao_liberado_ate_valor CHECK (valor_liberado >= 0 AND valor_liberado <= valor)
);

CREATE INDEX IF NOT EXISTS idx_comissoes_venda_empresa_usuario_criado
    ON comissoes_venda (empresa_id, usuario_id, criado_em);

CREATE INDEX IF NOT EXISTS idx_comissoes_venda_empresa_criado
    ON comissoes_venda (empresa_id, criado_em);

-- Histórico da comissão. Insert-only: a aplicação nunca faz UPDATE nem DELETE.
--   tipo: apurada (nasce com a venda), liberacao (+), reducao (-, ex.: estorno de pagamento),
--         estorno (venda cancelada).
--   delta: variação do valor liberado neste evento (negativa em reducao/estorno).
--   executado_por: quem causou o evento (NULL na apuração automática da venda).
CREATE TABLE IF NOT EXISTS comissoes_eventos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    comissao_id INTEGER NOT NULL REFERENCES comissoes_venda(id),
    venda_id INTEGER NOT NULL REFERENCES vendas(id),
    tipo VARCHAR(12) NOT NULL
        CHECK (tipo IN ('apurada', 'liberacao', 'reducao', 'estorno')),
    origem VARCHAR(24) NOT NULL
        CHECK (origem IN ('venda', 'pagamento', 'repasse', 'estorno_pagamento', 'cancelamento_venda', 'conta_receber')),
    delta NUMERIC(15,2) NOT NULL DEFAULT 0,
    valor_liberado_apos NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (valor_liberado_apos >= 0),
    repasse_id INTEGER,
    executado_por INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comissoes_eventos_comissao
    ON comissoes_eventos (empresa_id, comissao_id, id);

-- Dinheiro recebido pelo vendedor na venda: fica 'a_repassar' até um gerente/admin
-- (nunca o próprio vendedor) confirmar que o valor chegou. Uma linha por pagamento em
-- dinheiro de venda que tem comissão. 'cancelado' quando a venda é cancelada antes.
CREATE TABLE IF NOT EXISTS comissao_repasses (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    pagamento_id INTEGER NOT NULL UNIQUE REFERENCES pagamentos_venda(id),
    venda_id INTEGER NOT NULL REFERENCES vendas(id),
    vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
    status VARCHAR(12) NOT NULL DEFAULT 'a_repassar'
        CHECK (status IN ('a_repassar', 'confirmado', 'cancelado')),
    declarado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    confirmado_em TIMESTAMP,
    confirmado_por INTEGER REFERENCES usuarios(id),
    observacao TEXT,
    CONSTRAINT ck_repasse_confirmacao CHECK (
        (status = 'confirmado' AND confirmado_em IS NOT NULL AND confirmado_por IS NOT NULL)
        OR (status <> 'confirmado' AND confirmado_em IS NULL AND confirmado_por IS NULL)
    ),
    CONSTRAINT ck_repasse_nao_se_autoconfirma CHECK (confirmado_por IS NULL OR confirmado_por <> vendedor_id)
);

CREATE INDEX IF NOT EXISTS idx_comissao_repasses_empresa_status
    ON comissao_repasses (empresa_id, status, declarado_em);

CREATE INDEX IF NOT EXISTS idx_comissao_repasses_vendedor
    ON comissao_repasses (empresa_id, vendedor_id, status);

-- Reversão manual (não executada pelo runner; só se nenhuma comissão tiver sido paga):
--   DROP TABLE IF EXISTS comissao_repasses;
--   DROP TABLE IF EXISTS comissoes_eventos;
--   DROP TABLE IF EXISTS comissoes_venda;
--   DROP TABLE IF EXISTS comissao_percentuais;
