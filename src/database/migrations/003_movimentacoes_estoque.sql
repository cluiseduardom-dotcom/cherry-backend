-- Stock movement ledger: every change to produtos.estoque_atual should go through
-- this table so there's an auditable history. entrada/saida move estoque_atual by
-- +-quantidade; ajuste sets estoque_atual to quantidade (an absolute correction,
-- e.g. after a physical count). estoque_resultante snapshots the balance right
-- after the movement so history reads don't need to recompute it.

CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
    id SERIAL PRIMARY KEY,
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste')),
    quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
    estoque_resultante INTEGER NOT NULL,
    motivo VARCHAR(255),
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_produto_id ON movimentacoes_estoque(produto_id);
