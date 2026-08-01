CREATE TABLE empresas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    cnpj VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'inativa')),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nome VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    papel VARCHAR(20) NOT NULL CHECK (papel IN ('admin', 'vendedor', 'estoquista')),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nome VARCHAR(255) NOT NULL,
    telefone VARCHAR(20),
    email VARCHAR(255)
);

CREATE TABLE produtos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    sku VARCHAR(50) UNIQUE,
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    categoria VARCHAR(100),
    preco_venda NUMERIC(10, 2) NOT NULL,
    custo NUMERIC(10, 2) NOT NULL,
    estoque_atual INTEGER NOT NULL DEFAULT 0,
    estoque_minimo INTEGER NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE canais_venda (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nome VARCHAR(50) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (empresa_id, nome)
);

CREATE TABLE precos_produto (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    canal_id INTEGER NOT NULL REFERENCES canais_venda(id),
    preco_venda NUMERIC(10, 2) NOT NULL,
    markup_percentual NUMERIC(10, 2) NOT NULL,
    margem_percentual NUMERIC(10, 2) NOT NULL,
    vigente_desde TIMESTAMP NOT NULL DEFAULT NOW(),
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE vendas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    cliente_id INTEGER REFERENCES clientes(id),
    canal_id INTEGER NOT NULL REFERENCES canais_venda(id),
    usuario_id INTEGER REFERENCES usuarios(id),
    status VARCHAR(20) NOT NULL DEFAULT 'finalizada' CHECK (status IN ('aberta', 'finalizada', 'cancelada')),
    total NUMERIC(10, 2) NOT NULL DEFAULT 0,
    data TIMESTAMP NOT NULL DEFAULT NOW(),
    forma_pagamento VARCHAR(20) NOT NULL DEFAULT 'a_vista' CHECK (forma_pagamento IN ('a_vista', 'prazo'))
);

CREATE TABLE itens_venda (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    venda_id INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    quantidade INTEGER NOT NULL,
    preco_unitario NUMERIC(10, 2) NOT NULL
);

CREATE TABLE movimentacoes_estoque (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste')),
    quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
    estoque_resultante INTEGER NOT NULL,
    motivo VARCHAR(255),
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE contas_pagar (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    descricao VARCHAR(255) NOT NULL,
    fornecedor VARCHAR(255),
    valor NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    data_vencimento DATE NOT NULL,
    data_pagamento DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
    categoria VARCHAR(100),
    observacao TEXT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE contas_receber (
    id SERIAL PRIMARY KEY,
    venda_id INTEGER NOT NULL UNIQUE REFERENCES vendas(id),
    descricao VARCHAR(255) NOT NULL,
    valor NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    data_vencimento DATE NOT NULL,
    data_recebimento DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'recebido', 'cancelado')),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vendas_cliente_id ON vendas(cliente_id);
CREATE INDEX idx_vendas_canal_id ON vendas(canal_id);
CREATE INDEX idx_vendas_usuario_id ON vendas(usuario_id);
CREATE INDEX idx_itens_venda_venda_id ON itens_venda(venda_id);
CREATE INDEX idx_itens_venda_produto_id ON itens_venda(produto_id);
CREATE INDEX idx_movimentacoes_estoque_produto_id ON movimentacoes_estoque(produto_id);
CREATE INDEX idx_precos_produto_produto_canal ON precos_produto(produto_id, canal_id, criado_em DESC);
CREATE INDEX idx_contas_pagar_status ON contas_pagar(status);
CREATE INDEX idx_contas_pagar_vencimento ON contas_pagar(data_vencimento);
CREATE INDEX idx_contas_pagar_usuario_id ON contas_pagar(usuario_id);
CREATE INDEX idx_usuarios_empresa_id ON usuarios(empresa_id);
CREATE INDEX idx_clientes_empresa_id ON clientes(empresa_id);
CREATE INDEX idx_produtos_empresa_id ON produtos(empresa_id);
CREATE INDEX idx_canais_venda_empresa_id ON canais_venda(empresa_id);
CREATE INDEX idx_precos_produto_empresa_id ON precos_produto(empresa_id);
CREATE INDEX idx_vendas_empresa_id ON vendas(empresa_id);
CREATE INDEX idx_itens_venda_empresa_id ON itens_venda(empresa_id);
CREATE INDEX idx_movimentacoes_estoque_empresa_id ON movimentacoes_estoque(empresa_id);
CREATE INDEX idx_contas_pagar_empresa_id ON contas_pagar(empresa_id);
CREATE INDEX idx_contas_receber_status ON contas_receber(status);
CREATE INDEX idx_contas_receber_vencimento ON contas_receber(data_vencimento);
CREATE INDEX idx_contas_receber_empresa_id ON contas_receber(empresa_id);
