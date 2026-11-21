-- 122: ordem de produção do PCP (PR 2): planejada -> em produção -> concluída (ou cancelada).
--
-- Convive com `producoes` (migration 013), que continua igual: produção imediata, sem estados. A ordem é para quem
-- planeja antes de produzir: registra o que se pretende fazer (quantidade_planejada, prazo), o que de fato saiu
-- (quantidade_produzida) e o que se perdeu (quantidade_perdida). Insumos são consumidos NA CONCLUSÃO,
-- (produzida + perdida) × consumo por unidade da ficha congelada na criação; o acabado entra com a produzida.
-- `custo_insumos` congela o custo dos insumos consumidos naquele momento (custo real, com a perda dentro).
-- Planejar e iniciar NÃO mexem no estoque (não há reserva de insumo nesta etapa).
-- Quantidades INTEGER, como o resto do estoque (decimais vêm com o módulo Fracionado).
-- Ordem concluída não se cancela (corrige-se por ajuste de estoque, com motivo): histórico nunca é apagado.
-- FKs compostas com empresa_id para produto e usuários. Idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS ordens_producao (
    id                   SERIAL PRIMARY KEY,
    empresa_id           INTEGER      NOT NULL REFERENCES empresas (id),
    produto_id           INTEGER      NOT NULL,
    ficha_tecnica_id     INTEGER      NOT NULL REFERENCES fichas_tecnicas (id),
    quantidade_planejada INTEGER      NOT NULL,
    quantidade_produzida INTEGER,
    quantidade_perdida   INTEGER      NOT NULL DEFAULT 0,
    status               VARCHAR(20)  NOT NULL DEFAULT 'planejada',
    prazo                DATE,
    observacao           VARCHAR(500),
    custo_insumos        NUMERIC(14, 2),
    criado_por           INTEGER,
    criado_em            TIMESTAMP    NOT NULL DEFAULT NOW(),
    iniciada_por         INTEGER,
    iniciada_em          TIMESTAMP,
    concluida_por        INTEGER,
    concluida_em         TIMESTAMP,
    cancelada_por        INTEGER,
    cancelada_em         TIMESTAMP,
    motivo_cancelamento  VARCHAR(200),
    atualizado_em        TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT ordens_producao_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
    CONSTRAINT ordens_producao_criado_por_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT ordens_producao_iniciada_por_fk FOREIGN KEY (iniciada_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT ordens_producao_concluida_por_fk FOREIGN KEY (concluida_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT ordens_producao_cancelada_por_fk FOREIGN KEY (cancelada_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT ordens_producao_status_chk CHECK (status IN ('planejada', 'em_producao', 'concluida', 'cancelada')),
    CONSTRAINT ordens_producao_planejada_chk CHECK (quantidade_planejada > 0),
    CONSTRAINT ordens_producao_produzida_chk CHECK (quantidade_produzida IS NULL OR quantidade_produzida >= 0),
    CONSTRAINT ordens_producao_perdida_chk CHECK (quantidade_perdida >= 0),
    CONSTRAINT ordens_producao_custo_chk CHECK (custo_insumos IS NULL OR custo_insumos >= 0),
    CONSTRAINT ordens_producao_concluida_coerente_chk CHECK (
        status <> 'concluida' OR (quantidade_produzida IS NOT NULL AND concluida_em IS NOT NULL AND quantidade_produzida + quantidade_perdida >= 1)
    ),
    CONSTRAINT ordens_producao_cancelada_coerente_chk CHECK (status <> 'cancelada' OR cancelada_em IS NOT NULL),
    CONSTRAINT ordens_producao_id_empresa_uk UNIQUE (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_ordens_producao_empresa_status ON ordens_producao (empresa_id, status, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_ordens_producao_produto ON ordens_producao (empresa_id, produto_id);

-- Reversão manual (não executada pelo runner):
--   DROP TABLE IF EXISTS ordens_producao;
