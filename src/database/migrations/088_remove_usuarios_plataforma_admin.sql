-- Remove usuarios.plataforma_admin (Painel GiroNex, etapa 3 — fechamento).
--
-- A marca foi criada na 073 para liberar /plataforma/* a um usuário de loja. Essas rotas e o
-- middleware foram removidos no #201 (operação da plataforma agora é o Painel GiroNex, com
-- operadores próprios em plataforma_operadores). Nenhum código lê ou escreve a coluna.
-- Irreversível: snapshot Neon `pre-088-drop-plataforma_admin` tirado antes do deploy.
-- IF EXISTS mantém a migration idempotente (ambientes que já não têm a coluna).

ALTER TABLE usuarios
    DROP COLUMN IF EXISTS plataforma_admin;
