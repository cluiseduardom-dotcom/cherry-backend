-- Identidade visual por empresa (cherry-frontend#63). O backend só guarda e devolve
-- um identificador do conjunto fechado do frontend; nunca logotipo, cor ou CSS.
-- Aditiva e idempotente: toda empresa existente fica no padrão 'vertumno', exceto a
-- Cherry Semijoias. Reversão manual no rodapé.
ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS tema_visual VARCHAR(30) NOT NULL DEFAULT 'vertumno';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empresas_tema_visual_chk') THEN
        ALTER TABLE empresas
            ADD CONSTRAINT empresas_tema_visual_chk CHECK (tema_visual IN ('vertumno', 'cherry'));
    END IF;
END $$;

UPDATE empresas SET tema_visual = 'cherry'
WHERE nome = 'Cherry Semijoias' AND tema_visual <> 'cherry';

-- Reversão manual (não executada pelo runner):
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_tema_visual_chk;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS tema_visual;
