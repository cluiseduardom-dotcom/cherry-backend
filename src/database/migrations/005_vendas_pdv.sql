-- PDV/vendas: adiciona canal, quem vendeu e status à venda; cliente passa a ser
-- opcional (venda sem cliente identificado, ex: balcão). itens_venda.preco_unitario
-- é mantido como está — já representa o preço travado no momento da venda (nunca
-- recalculado depois), só que agora vem do preço vigente em precos_produto em vez
-- de ser informado pelo cliente.
--
-- A coluna "data" (timestamp de criação da venda) é mantida com esse nome, e não
-- renomeada para "criado_em": produtosRepository já depende de "v.data" em várias
-- consultas (getGiro, getParados, getPricingProfissional, getMaisVendidos,
-- getCurvaABC, getReposicao, getSugestaoPreco, getInteligencia, getAcoes) e
-- renomear exigiria tocar no módulo de produtos além do necessário.

ALTER TABLE vendas ALTER COLUMN cliente_id DROP NOT NULL;

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS canal_id INTEGER REFERENCES canais_venda(id);
UPDATE vendas SET canal_id = (SELECT id FROM canais_venda WHERE nome = 'loja_fisica') WHERE canal_id IS NULL;
ALTER TABLE vendas ALTER COLUMN canal_id SET NOT NULL;

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id);

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'finalizada'
    CHECK (status IN ('aberta', 'finalizada', 'cancelada'));

CREATE INDEX IF NOT EXISTS idx_vendas_usuario_id ON vendas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_vendas_canal_id ON vendas(canal_id);
