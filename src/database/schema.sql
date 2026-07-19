CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    papel VARCHAR(20) NOT NULL CHECK (papel IN ('admin', 'vendedor', 'estoquista')),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    telefone VARCHAR(20),
    email VARCHAR(255)
);

CREATE TABLE produtos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    preco_venda NUMERIC(10, 2) NOT NULL,
    custo NUMERIC(10, 2) NOT NULL
);

CREATE TABLE vendas (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    total NUMERIC(10, 2) NOT NULL DEFAULT 0,
    data TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE itens_venda (
    id SERIAL PRIMARY KEY,
    venda_id INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    quantidade INTEGER NOT NULL,
    preco_unitario NUMERIC(10, 2) NOT NULL
);

CREATE INDEX idx_vendas_cliente_id ON vendas(cliente_id);
CREATE INDEX idx_itens_venda_venda_id ON itens_venda(venda_id);
CREATE INDEX idx_itens_venda_produto_id ON itens_venda(produto_id);
