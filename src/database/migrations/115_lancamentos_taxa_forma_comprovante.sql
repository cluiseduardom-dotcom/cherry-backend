-- Taxas a receber, correção da 114 (decisões do PO em 15/11/2026, após o merge da 114):
--
-- * forma_pagamento em lista fechada: pix, transferencia, boleto.
-- * comprovante guardado no S3, como os demais uploads: a coluna passa a guardar só a chave do objeto
--   (comprovante -> comprovante_chave VARCHAR(300)).
--
-- A 114 não é editada (já mergeada). Nenhuma rota escreve lancamentos_taxa ainda, então a tabela está
-- vazia em todos os ambientes; mesmo assim a troca de tipo e o CHECK falham (e a migration inteira volta)
-- se existir dado fora da regra, em vez de alterá-lo. Idempotente. Reversão manual no rodapé.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'lancamentos_taxa' AND column_name = 'comprovante') THEN
        ALTER TABLE lancamentos_taxa RENAME COLUMN comprovante TO comprovante_chave;
    END IF;
END $$;

ALTER TABLE lancamentos_taxa ALTER COLUMN comprovante_chave TYPE VARCHAR(300);
ALTER TABLE lancamentos_taxa ALTER COLUMN forma_pagamento TYPE VARCHAR(20);

-- A restrição de pagamento da 114 citava a coluna pelo nome antigo; o PostgreSQL acompanha o RENAME
-- automaticamente, então ela segue válida sem recriação.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'ck_lancamentos_taxa_forma_pagamento' AND conrelid = 'lancamentos_taxa'::regclass) THEN
        ALTER TABLE lancamentos_taxa
            ADD CONSTRAINT ck_lancamentos_taxa_forma_pagamento
            CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('pix', 'transferencia', 'boleto'));
    END IF;
END $$;

-- Reversão manual (não executada pelo runner):
--   ALTER TABLE lancamentos_taxa DROP CONSTRAINT IF EXISTS ck_lancamentos_taxa_forma_pagamento;
--   ALTER TABLE lancamentos_taxa ALTER COLUMN forma_pagamento TYPE VARCHAR(40);
--   ALTER TABLE lancamentos_taxa ALTER COLUMN comprovante_chave TYPE TEXT;
--   ALTER TABLE lancamentos_taxa RENAME COLUMN comprovante_chave TO comprovante;
