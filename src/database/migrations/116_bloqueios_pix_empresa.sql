-- Bloqueio de Pix por empresa (Taxas a receber, SPEC §5 T7 e §7): estado com motivo, quem abriu, quando e quem liberou.
-- Hoje só o motivo 'pix_manual_sinalizado' é criado (pelo operador do Painel GiroNex: bloqueia o LANÇAMENTO de Pix manual
-- na venda; Pix do Mercado Pago, dinheiro, cartão e crediário continuam). 'suspensao_taxa' é do ciclo de cobrança (etapa 5):
-- já fica previsto aqui para não precisar de outra migration.
--
-- Histórico protegido: uma linha por bloqueio, nunca apagada. A liberação só PREENCHE as colunas liberado_* (quem, quando e
-- justificativa obrigatória) e não se desfaz; para bloquear de novo, nasce outra linha. Só pode haver um bloqueio ATIVO por
-- empresa e motivo (índice único parcial): dois cliques ou duas abas não duplicam.
-- empresa_id vem da rota do painel (exceção deliberada, como plano e condição); o backend de tenant consulta esta tabela
-- pela empresa do JWT e nunca a expõe nem devolve o motivo ao cliente da loja.
--
-- Aditiva e idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS bloqueios_pix_empresa (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas (id),
    motivo VARCHAR(30) NOT NULL,
    justificativa TEXT NOT NULL,
    aberto_por VARCHAR(255) NOT NULL,
    aberto_por_operador_id INTEGER REFERENCES plataforma_operadores (id),
    aberto_em TIMESTAMP NOT NULL DEFAULT NOW(),
    liberado_em TIMESTAMP,
    liberado_por VARCHAR(255),
    liberado_por_operador_id INTEGER REFERENCES plataforma_operadores (id),
    justificativa_liberacao TEXT,

    CONSTRAINT ck_bloqueios_pix_motivo CHECK (motivo IN ('suspensao_taxa', 'pix_manual_sinalizado')),
    CONSTRAINT ck_bloqueios_pix_justificativa CHECK (length(btrim(justificativa)) >= 5),
    CONSTRAINT ck_bloqueios_pix_aberto_por CHECK (btrim(aberto_por) <> ''),
    CONSTRAINT ck_bloqueios_pix_liberacao CHECK (
        (liberado_em IS NULL AND liberado_por IS NULL AND liberado_por_operador_id IS NULL AND justificativa_liberacao IS NULL)
        OR (liberado_em IS NOT NULL AND liberado_por IS NOT NULL AND btrim(liberado_por) <> ''
            AND justificativa_liberacao IS NOT NULL AND length(btrim(justificativa_liberacao)) >= 5)
    )
);

-- Um bloqueio ativo por empresa e motivo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bloqueios_pix_ativo
    ON bloqueios_pix_empresa (empresa_id, motivo) WHERE liberado_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_bloqueios_pix_empresa ON bloqueios_pix_empresa (empresa_id, aberto_em DESC);

-- Sem DELETE; o único UPDATE permitido é a liberação (preenche liberado_*), uma vez só. Bypass só na limpeza dos testes.
CREATE OR REPLACE FUNCTION bloqueios_pix_empresa_protegido() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'bloqueios_pix_empresa não pode ser apagado' USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.liberado_em IS NOT NULL THEN
        RAISE EXCEPTION 'bloqueio já liberado é imutável (crie outro bloqueio)' USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.liberado_em IS NULL
       OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.motivo IS DISTINCT FROM OLD.motivo
       OR NEW.justificativa IS DISTINCT FROM OLD.justificativa OR NEW.aberto_por IS DISTINCT FROM OLD.aberto_por
       OR NEW.aberto_por_operador_id IS DISTINCT FROM OLD.aberto_por_operador_id OR NEW.aberto_em IS DISTINCT FROM OLD.aberto_em THEN
        RAISE EXCEPTION 'bloqueio só pode ser liberado (os demais campos são imutáveis)' USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bloqueios_pix_empresa_protegido ON bloqueios_pix_empresa;
CREATE TRIGGER trg_bloqueios_pix_empresa_protegido
    BEFORE UPDATE OR DELETE ON bloqueios_pix_empresa
    FOR EACH ROW EXECUTE FUNCTION bloqueios_pix_empresa_protegido();

-- Reversão manual (não executada pelo runner; só antes de existir bloqueio real):
--   DROP TABLE IF EXISTS bloqueios_pix_empresa;
--   DROP FUNCTION IF EXISTS bloqueios_pix_empresa_protegido();
