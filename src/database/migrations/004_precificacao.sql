-- Precificação: preço por canal de venda, calculado e com histórico.
-- canais_venda é uma tabela de referência simples (nome + ativo).
-- precos_produto é um ledger append-only, no mesmo espírito de movimentacoes_estoque:
-- alterar o preço insere uma nova linha, nunca faz UPDATE. O preço vigente de um
-- produto+canal é sempre a linha mais recente (maior criado_em/id) daquele par.

CREATE TABLE IF NOT EXISTS canais_venda (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE,
    ativo BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO canais_venda (nome) VALUES
    ('loja_fisica'),
    ('online')
ON CONFLICT (nome) DO NOTHING;

CREATE TABLE IF NOT EXISTS precos_produto (
    id SERIAL PRIMARY KEY,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    canal_id INTEGER NOT NULL REFERENCES canais_venda(id),
    preco_venda NUMERIC(10, 2) NOT NULL,
    markup_percentual NUMERIC(10, 2) NOT NULL,
    margem_percentual NUMERIC(10, 2) NOT NULL,
    vigente_desde TIMESTAMP NOT NULL DEFAULT NOW(),
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_precos_produto_produto_canal ON precos_produto(produto_id, canal_id, criado_em DESC);
