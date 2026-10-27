-- Senha temporária (redefinição por admin): o usuário só consegue trocar a senha até concluir a troca.
-- Aditiva e idempotente; todo usuário existente fica com false (comportamento atual).
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS senha_temporaria BOOLEAN NOT NULL DEFAULT false;

-- Reversão manual (não executada pelo runner):
--   ALTER TABLE usuarios DROP COLUMN IF EXISTS senha_temporaria;
