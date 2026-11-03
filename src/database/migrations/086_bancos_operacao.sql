-- Bancos (fatia A): torna o módulo de contas/movimentos operável com segurança.
--
-- * Movimento não se apaga nem se altera: erro se corrige CANCELANDO (cancelado_em + motivo), e o saldo
--   ignora cancelados. Só `conciliado`, `observacao` e os campos de cancelamento mudam depois de criado.
-- * Lançamento automático/importado é idempotente: a mesma referência externa, na mesma conta e origem,
--   nunca entra duas vezes (inclusive se o movimento original foi cancelado: não ressuscita sozinho).
-- * Fluxo de caixa e saldo nunca contam cancelados.
--
-- Aditiva. Reversão manual: DROP TRIGGER trg_mov_banc_imutavel ON movimentos_bancarios;
--   DROP INDEX uq_mov_banc_referencia; ALTER TABLE movimentos_bancarios DROP COLUMN cancelado_em, ...

ALTER TABLE movimentos_bancarios
    ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelado_por BIGINT REFERENCES usuarios(id),
    ADD COLUMN IF NOT EXISTS motivo_cancelamento VARCHAR(200);

ALTER TABLE movimentos_bancarios DROP CONSTRAINT IF EXISTS ck_mov_banc_cancelamento;
ALTER TABLE movimentos_bancarios
    ADD CONSTRAINT ck_mov_banc_cancelamento CHECK (
        (cancelado_em IS NULL AND motivo_cancelamento IS NULL)
        OR (cancelado_em IS NOT NULL AND motivo_cancelamento IS NOT NULL AND length(btrim(motivo_cancelamento)) >= 3)
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_mov_banc_referencia
    ON movimentos_bancarios (empresa_id, conta_bancaria_id, origem, referencia_externa)
    WHERE referencia_externa IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mov_banc_empresa_ativos
    ON movimentos_bancarios (empresa_id, conta_bancaria_id, data_movimento)
    WHERE cancelado_em IS NULL;

CREATE OR REPLACE FUNCTION movimentos_bancarios_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'movimentos_bancarios não pode ser apagado: cancele o movimento' USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.conta_bancaria_id IS DISTINCT FROM OLD.conta_bancaria_id
       OR NEW.tipo IS DISTINCT FROM OLD.tipo
       OR NEW.origem IS DISTINCT FROM OLD.origem
       OR NEW.valor IS DISTINCT FROM OLD.valor
       OR NEW.data_movimento IS DISTINCT FROM OLD.data_movimento
       OR NEW.referencia_externa IS DISTINCT FROM OLD.referencia_externa THEN
        RAISE EXCEPTION 'movimentos_bancarios: valor, tipo, data e conta não se alteram; cancele e lance de novo' USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.cancelado_em IS NOT NULL AND (
           NEW.cancelado_em IS DISTINCT FROM OLD.cancelado_em
        OR NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento) THEN
        RAISE EXCEPTION 'movimentos_bancarios: movimento cancelado não se reabre' USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mov_banc_imutavel ON movimentos_bancarios;
CREATE TRIGGER trg_mov_banc_imutavel
    BEFORE UPDATE OR DELETE ON movimentos_bancarios
    FOR EACH ROW EXECUTE FUNCTION movimentos_bancarios_imutavel();

-- Conciliação: a unicidade valia para QUALQUER linha do movimento, então depois de desfazer não dava para
-- conciliar de novo. Passa a valer só para a conciliação ativa (uma por movimento).
ALTER TABLE conciliacoes_bancarias DROP CONSTRAINT IF EXISTS uq_conc_movimento;
CREATE UNIQUE INDEX IF NOT EXISTS uq_conc_movimento_ativa
    ON conciliacoes_bancarias (movimento_bancario_id) WHERE status = 'CONCILIADA';
