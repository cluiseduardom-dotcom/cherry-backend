-- 039: idempotência do evento de aprovação de recebimento.
-- Um recebimento aprovado representa um único evento de negócio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_evento_recebimento_aprovado
    ON eventos_negocio (empresa_id, entidade_id)
    WHERE tipo_evento = 'RECEBIMENTO_APROVADO' AND entidade_tipo = 'RECEBIMENTO';
