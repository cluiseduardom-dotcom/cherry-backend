-- Cadastro de fornecedores: entidade própria, separada do campo de texto
-- livre `produtos.fornecedor` (que continua existindo em paralelo por
-- enquanto). A migração de dados de produtos.fornecedor -> fornecedores.id
-- fica para uma sessão futura, depois de validação manual do cadastro — fora
-- do escopo desta migration.

CREATE TABLE IF NOT EXISTS fornecedores (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nome VARCHAR(255) NOT NULL,
    contato VARCHAR(255),
    telefone VARCHAR(20),
    email VARCHAR(255),
    cnpj_cpf VARCHAR(20),
    observacoes TEXT,
    ativo BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fornecedores_empresa_id ON fornecedores(empresa_id);
