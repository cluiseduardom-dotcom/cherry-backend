-- Marca de operador da plataforma (VERTUMNO/GiroOne).
--
-- Quem tem plataforma_admin = true (e papel admin) pode LER dados agregados de todas as
-- empresas em /plataforma/* (hoje: taxa da plataforma a receber por empresa/mês).
-- A marca NUNCA é escrita por rota de API: nenhuma tela de empresa consegue ligá-la.
-- Ela é concedida pela operação, por SQL, só ao(s) operador(es) da plataforma.
-- Padrão false: nenhum usuário existente ganha acesso entre empresas.

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS plataforma_admin BOOLEAN NOT NULL DEFAULT false;
