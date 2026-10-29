-- Devolução (estorno) de Pix cobrado pelo Mercado Pago. Uma linha por pedido de devolução; a cobrança
-- (cobrancas_pagamento) continua sendo a fonte do estado do Pix e vira 'estornado' quando o provedor confirma.
--
-- Só se devolve Pix PAGO que não está numa venda ativa: sem venda, ou venda cancelada. Quem decide e quando
-- é o financeiro (capacidade gerir_financeiro); a trilha guarda quem pediu, o motivo e o resultado.
-- O índice único parcial impede duas devoluções ativas (solicitada/concluída) da mesma cobrança.
-- Migration só aditiva. Reversão manual: DROP TABLE cobranca_devolucoes;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cobrancas_id_empresa ON cobrancas_pagamento (id, empresa_id);

CREATE TABLE IF NOT EXISTS cobranca_devolucoes (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    cobranca_id INTEGER NOT NULL,
    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'solicitada' CHECK (status IN ('solicitada', 'concluida', 'falhou')),
    motivo VARCHAR(200) NOT NULL,
    -- id da devolução no provedor (só informativo).
    id_externo VARCHAR(64),
    -- Mensagem curta e sem dados sensíveis (nunca corpo de requisição, token ou resposta bruta).
    erro VARCHAR(200),
    solicitado_por INTEGER NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cobranca_devolucoes_cobranca_fk FOREIGN KEY (cobranca_id, empresa_id) REFERENCES cobrancas_pagamento (id, empresa_id),
    CONSTRAINT cobranca_devolucoes_usuario_fk FOREIGN KEY (solicitado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT cobranca_devolucoes_motivo_chk CHECK (length(btrim(motivo)) >= 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_devolucao_ativa
    ON cobranca_devolucoes (cobranca_id) WHERE status IN ('solicitada', 'concluida');

CREATE INDEX IF NOT EXISTS idx_cobranca_devolucoes_empresa
    ON cobranca_devolucoes (empresa_id, criado_em DESC);
