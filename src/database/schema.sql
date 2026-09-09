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
    email VARCHAR(255),
    ativo BOOLEAN NOT NULL DEFAULT true,
    anonimizado BOOLEAN NOT NULL DEFAULT false,
    anonimizado_em TIMESTAMP
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
    preco_unitario NUMERIC(10, 2) NOT NULL,
    custo_unitario NUMERIC(10, 2) NOT NULL CHECK (custo_unitario >= 0)
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
    -- compra_id (FK pra compras, UNIQUE, nullable) é adicionado via ALTER
    -- logo depois da tabela compras existir, mais abaixo neste arquivo —
    -- não dá pra referenciar compras aqui porque ela ainda não foi criada
    -- neste ponto do script.
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

CREATE TABLE fornecedores (
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

CREATE TABLE compras (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    fornecedor_id INTEGER NOT NULL REFERENCES fornecedores(id),
    data_compra DATE NOT NULL,
    nota_fiscal VARCHAR(50),
    forma_pagamento VARCHAR(20) NOT NULL DEFAULT 'a_vista' CHECK (forma_pagamento IN ('a_vista', 'prazo')),
    dias_prazo INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'recebido' CHECK (status IN ('recebido', 'pendente', 'cancelado')),
    valor_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE despesas_fixas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    categoria VARCHAR(20) NOT NULL CHECK (categoria IN ('estrutural', 'pessoal', 'administrativa')),
    descricao VARCHAR(255) NOT NULL,
    valor NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
    ativo BOOLEAN NOT NULL DEFAULT true,
    vigencia_inicio DATE NOT NULL,
    vigencia_fim DATE,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    deletado_em TIMESTAMP,
    CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);

CREATE TABLE configuracoes_financeiras (
    empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id),
    aliquota_imposto NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (aliquota_imposto >= 0 AND aliquota_imposto <= 1),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE itens_compra (
    id SERIAL PRIMARY KEY,
    compra_id INTEGER NOT NULL REFERENCES compras(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    quantidade INTEGER NOT NULL,
    custo_unitario NUMERIC(10, 2) NOT NULL
);

ALTER TABLE contas_pagar ADD COLUMN compra_id INTEGER UNIQUE REFERENCES compras(id);

ALTER TABLE produtos ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'acabado' CHECK (tipo IN ('acabado', 'insumo'));

CREATE TABLE fichas_tecnicas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    vigente BOOLEAN NOT NULL DEFAULT true,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_fichas_tecnicas_vigente_unica ON fichas_tecnicas(empresa_id, produto_id) WHERE vigente = true;

CREATE TABLE itens_ficha_tecnica (
    id SERIAL PRIMARY KEY,
    ficha_tecnica_id INTEGER NOT NULL REFERENCES fichas_tecnicas(id),
    insumo_produto_id INTEGER NOT NULL REFERENCES produtos(id),
    quantidade_necessaria INTEGER NOT NULL CHECK (quantidade_necessaria > 0),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id)
);

CREATE TABLE producoes (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    ficha_tecnica_id INTEGER NOT NULL REFERENCES fichas_tecnicas(id),
    quantidade_solicitada INTEGER NOT NULL CHECK (quantidade_solicitada > 0),
    quantidade_produzida INTEGER NOT NULL CHECK (quantidade_produzida >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida', 'cancelada')),
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fichas_tecnicas_empresa_id ON fichas_tecnicas(empresa_id);
CREATE INDEX idx_fichas_tecnicas_produto_id ON fichas_tecnicas(produto_id);
CREATE INDEX idx_itens_ficha_tecnica_ficha_tecnica_id ON itens_ficha_tecnica(ficha_tecnica_id);
CREATE INDEX idx_itens_ficha_tecnica_insumo_produto_id ON itens_ficha_tecnica(insumo_produto_id);
CREATE INDEX idx_itens_ficha_tecnica_empresa_id ON itens_ficha_tecnica(empresa_id);
CREATE INDEX idx_producoes_empresa_id ON producoes(empresa_id);
CREATE INDEX idx_producoes_produto_id ON producoes(produto_id);
CREATE INDEX idx_producoes_ficha_tecnica_id ON producoes(ficha_tecnica_id);

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
CREATE INDEX idx_fornecedores_empresa_id ON fornecedores(empresa_id);
CREATE INDEX idx_compras_empresa_id ON compras(empresa_id);
CREATE INDEX idx_compras_fornecedor_id ON compras(fornecedor_id);
CREATE INDEX idx_compras_data_compra ON compras(data_compra);
CREATE INDEX idx_itens_compra_compra_id ON itens_compra(compra_id);
CREATE INDEX idx_itens_compra_produto_id ON itens_compra(produto_id);
CREATE INDEX idx_itens_compra_empresa_id ON itens_compra(empresa_id);
CREATE INDEX idx_contas_pagar_compra_id ON contas_pagar(compra_id);
CREATE INDEX idx_despesas_fixas_empresa_id ON despesas_fixas(empresa_id);
