-- Taxa interna da plataforma (VERTUMNO/GiroOne): UMA linha por venda.
--
-- Ledger interno, nunca exposto na API de vendas, no PDV, em recibo ou em
-- documento fiscal. Gerada dentro da mesma transação da venda
-- (vendasRepository.criar): sem política vigente ou com qualquer falha, a venda
-- inteira sofre ROLLBACK. Vinculada à VENDA, não a cada pagamento/parcela —
-- PIX + Crédito gera UMA taxa.
--
-- tipo/percentual/politica_id são o CONGELAMENTO da regra aplicada: uma política
-- nova não altera taxas já gravadas. Taxa de gateway/adquirente e juros do
-- crediário NÃO entram aqui (conceitos separados).
--
-- Não apagar linhas: o cancelamento da venda marca status = 'estornada'.

CREATE TABLE IF NOT EXISTS taxas_venda (
    id SERIAL PRIMARY KEY,
    venda_id INTEGER NOT NULL UNIQUE REFERENCES vendas(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    politica_id INTEGER NOT NULL REFERENCES politicas_taxa_plataforma(id),

    tipo VARCHAR(20) NOT NULL,
    percentual NUMERIC(7,4) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),

    -- vendas.total no momento da venda (já com desconto e acréscimo comercial)
    base_calculo NUMERIC(15,2) NOT NULL CHECK (base_calculo >= 0),
    valor NUMERIC(15,2) NOT NULL CHECK (valor >= 0),

    status VARCHAR(20) NOT NULL DEFAULT 'apurada'
        CHECK (status IN ('apurada', 'estornada')),

    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    estornado_em TIMESTAMP,

    CONSTRAINT ck_taxa_venda_valor_ate_base CHECK (valor <= base_calculo)
);

CREATE INDEX IF NOT EXISTS idx_taxas_venda_empresa_criado
    ON taxas_venda (empresa_id, criado_em);

CREATE INDEX IF NOT EXISTS idx_taxas_venda_politica
    ON taxas_venda (politica_id);
