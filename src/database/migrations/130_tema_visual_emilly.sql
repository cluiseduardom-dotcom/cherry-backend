-- 130: tema visual `emilly` (Emilly Candy Designer), de DEMONSTRAÇÃO: confeitaria de teste com verde-menta e rosa pastel.
--
-- O conjunto de temas é fechado (CHECK) e acompanha o cherry-frontend (src/theme/themes.js). Nenhuma empresa existente muda: só
-- passa a ser aceito o valor 'emilly' em `empresas.tema_visual`. Idempotente.

ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_tema_visual_chk;
ALTER TABLE empresas
    ADD CONSTRAINT empresas_tema_visual_chk CHECK (tema_visual IN ('vertumno', 'cherry', 'valvazori', 'emilly'));

-- Reversão manual (não executada pelo runner; antes, nenhuma empresa pode usar o tema 'emilly'):
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_tema_visual_chk;
--   ALTER TABLE empresas ADD CONSTRAINT empresas_tema_visual_chk CHECK (tema_visual IN ('vertumno', 'cherry', 'valvazori'));
