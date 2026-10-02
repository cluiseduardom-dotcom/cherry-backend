-- Issue #81: conclui o contrato de backend já assumido pelo frontend
-- (cherry-frontend PR #46 / Issue #45, ver docs/ai/CLIENTES-HUB-BACKEND-
-- CONTRACT.md lá) para o hub de Clientes — CPF/CNPJ, endereço completo,
-- data de nascimento e observações, tudo aditivo e opcional, sem quebrar
-- nenhum cliente já cadastrado.
--
-- Sem criado_em/atualizado_em nesta tarefa (decisão do Product Owner,
-- reafirmada na issue — o KPI de "novos clientes no período" que
-- dependeria disso ficou fora do escopo).
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cpf_cnpj VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cep VARCHAR(10),
  ADD COLUMN IF NOT EXISTS endereco VARCHAR(255),
  ADD COLUMN IF NOT EXISTS numero VARCHAR(20),
  ADD COLUMN IF NOT EXISTS complemento VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bairro VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cidade VARCHAR(100),
  ADD COLUMN IF NOT EXISTS uf CHAR(2),
  ADD COLUMN IF NOT EXISTS data_nascimento DATE,
  ADD COLUMN IF NOT EXISTS observacoes TEXT;
