-- Origem de aquisição do tenant (SPEC 03, fase 4 — fornecedor como canal).
-- Registra, no onboarding, se a empresa chegou direto, por indicação de parceiro ou
-- por outra origem, para medir conversão e retenção por canal. É dado interno da
-- GiroOne: nenhuma rota de tenant lê ou altera estas colunas.
-- Sem tabela de parceiros nem FK: o cadastro de parceiros só existe na fase 4.
-- Aditiva e idempotente: toda empresa existente fica 'direta', sem parceiro.
-- Reversão manual no rodapé.
ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS origem_aquisicao VARCHAR(30) NOT NULL DEFAULT 'direta';

ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS parceiro_codigo VARCHAR(40);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'empresas_origem_aquisicao_chk' AND conrelid = 'empresas'::regclass) THEN
        ALTER TABLE empresas
            ADD CONSTRAINT empresas_origem_aquisicao_chk
            CHECK (origem_aquisicao IN ('direta', 'indicacao_parceiro', 'outro'));
    END IF;

    -- Parceiro informado se, e somente se, a origem for indicação de parceiro.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'empresas_parceiro_codigo_chk' AND conrelid = 'empresas'::regclass) THEN
        ALTER TABLE empresas
            ADD CONSTRAINT empresas_parceiro_codigo_chk
            CHECK ((origem_aquisicao = 'indicacao_parceiro') = (parceiro_codigo IS NOT NULL));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'empresas_parceiro_codigo_formato_chk' AND conrelid = 'empresas'::regclass) THEN
        ALTER TABLE empresas
            ADD CONSTRAINT empresas_parceiro_codigo_formato_chk
            CHECK (parceiro_codigo IS NULL OR parceiro_codigo ~ '^[A-Z0-9_-]{2,40}$');
    END IF;
END $$;

-- Reversão manual (não executada pelo runner):
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_parceiro_codigo_formato_chk;
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_parceiro_codigo_chk;
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_origem_aquisicao_chk;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS parceiro_codigo;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS origem_aquisicao;
