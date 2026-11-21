-- 123: consumo de insumos da ordem de produção, com pendência (PCP, PR 2b).
--
-- Regra do PO (21/11/2026): faltar insumo no sistema NÃO bloqueia a produção, porque o insumo pode existir
-- fisicamente e só não ter dado entrada ainda. Ao concluir a ordem, cada insumo é baixado em min(necessário, saldo do
-- Central); o que faltou fica como PENDÊNCIA (quantidade_prevista - quantidade_baixada) e é baixado depois, quando a
-- entrada chegar (PATCH /producoes/ordens/:id/regularizar-insumos). O estoque NUNCA fica negativo.
-- Mesmo desenho de venda_consumos (migration 069). `custo_unitario` congela o custo do insumo na conclusão.
-- Uma linha por (ordem, insumo). FKs compostas com empresa_id. Idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS ordem_producao_consumos (
    id                  SERIAL PRIMARY KEY,
    empresa_id          INTEGER        NOT NULL REFERENCES empresas (id),
    ordem_id            INTEGER        NOT NULL,
    insumo_produto_id   INTEGER        NOT NULL,
    local_id            INTEGER        NOT NULL,
    quantidade_prevista INTEGER        NOT NULL,
    quantidade_baixada  INTEGER        NOT NULL DEFAULT 0,
    custo_unitario      NUMERIC(14, 4) NOT NULL DEFAULT 0,
    criado_em           TIMESTAMP      NOT NULL DEFAULT NOW(),
    atualizado_em       TIMESTAMP      NOT NULL DEFAULT NOW(),
    CONSTRAINT ordem_producao_consumos_ordem_fk FOREIGN KEY (ordem_id, empresa_id) REFERENCES ordens_producao (id, empresa_id),
    CONSTRAINT ordem_producao_consumos_insumo_fk FOREIGN KEY (insumo_produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
    CONSTRAINT ordem_producao_consumos_local_fk FOREIGN KEY (local_id, empresa_id) REFERENCES locais_estoque (id, empresa_id),
    CONSTRAINT ordem_producao_consumos_quantidades_chk CHECK (
        quantidade_prevista > 0 AND quantidade_baixada >= 0 AND quantidade_baixada <= quantidade_prevista
    ),
    CONSTRAINT ordem_producao_consumos_custo_chk CHECK (custo_unitario >= 0),
    CONSTRAINT ordem_producao_consumos_uk UNIQUE (ordem_id, insumo_produto_id)
);

CREATE INDEX IF NOT EXISTS idx_ordem_producao_consumos_empresa_ordem ON ordem_producao_consumos (empresa_id, ordem_id);
CREATE INDEX IF NOT EXISTS idx_ordem_producao_consumos_pendentes
    ON ordem_producao_consumos (empresa_id, insumo_produto_id) WHERE quantidade_baixada < quantidade_prevista;

-- Reversão manual (não executada pelo runner):
--   DROP TABLE IF EXISTS ordem_producao_consumos;
