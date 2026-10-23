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
-- Não apagar linhas de comissão: o cancelamento da venda marca status = 'estornada'.
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

    status VARCHAR(20) NOT NULL DEFAULT 'apurada'
        CHECK (status IN ('apurada', 'estornada')),

    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    estornado_em TIMESTAMP,

    CONSTRAINT ck_comissao_valor_ate_base CHECK (valor <= base_calculo)
);

CREATE INDEX IF NOT EXISTS idx_comissoes_venda_empresa_usuario_criado
    ON comissoes_venda (empresa_id, usuario_id, criado_em);

CREATE INDEX IF NOT EXISTS idx_comissoes_venda_empresa_criado
    ON comissoes_venda (empresa_id, criado_em);

-- Reversão manual (não executada pelo runner; só se nenhuma comissão tiver sido paga):
--   DROP TABLE IF EXISTS comissoes_venda;
--   DROP TABLE IF EXISTS comissao_percentuais;
