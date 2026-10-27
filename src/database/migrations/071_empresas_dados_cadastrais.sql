-- Dados cadastrais da empresa (tela "Dados da empresa"). Aditiva e idempotente: colunas opcionais
-- na própria tabela empresas (a empresa É o tenant; o id vem sempre do JWT). `nome` segue sendo o
-- nome fantasia e `cnpj` (já existente) passa a guardar só dígitos quando preenchido pela tela.
ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS razao_social VARCHAR(255),
    ADD COLUMN IF NOT EXISTS telefone VARCHAR(11),
    ADD COLUMN IF NOT EXISTS email_contato VARCHAR(255),
    ADD COLUMN IF NOT EXISTS cep VARCHAR(8),
    ADD COLUMN IF NOT EXISTS logradouro VARCHAR(255),
    ADD COLUMN IF NOT EXISTS numero VARCHAR(20),
    ADD COLUMN IF NOT EXISTS complemento VARCHAR(100),
    ADD COLUMN IF NOT EXISTS bairro VARCHAR(100),
    ADD COLUMN IF NOT EXISTS cidade VARCHAR(100),
    ADD COLUMN IF NOT EXISTS uf VARCHAR(2),
    ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP,
    ADD COLUMN IF NOT EXISTS atualizado_por INTEGER;  -- sem FK: evitaria ciclo empresas<->usuarios na limpeza de tenants

-- Reversão manual (não executada pelo runner):
--   ALTER TABLE empresas DROP COLUMN IF EXISTS razao_social, DROP COLUMN IF EXISTS telefone, ... (as colunas acima).
