-- Migration 015: custo congelado em itens_venda.
-- Hoje margem e ponto de equilíbrio usam produtos.custo (custo atual) via
-- join, o que torna resultado histórico mutável: alterar o custo de um
-- produto reescreve a margem/ponto de equilíbrio de vendas já fechadas.
-- Mesmo padrão já resolvido do lado do preço (itens_venda.preco_unitario
-- congela o preço vigente no momento da venda) — custo ficou de fora por
-- omissão. Corrigido aqui.
--
-- Backfill com o custo ATUAL é seguro porque, na base de produção no momento
-- desta migration, nenhum custo mudou desde que os 22 itens de venda
-- existentes foram criados (9 produtos, custo mínimo 5.00, todos preenchidos,
-- zero compras registradas) — o backfill é correto por construção. Essa
-- janela fecha na primeira alteração de produtos.custo.

ALTER TABLE itens_venda ADD COLUMN custo_unitario NUMERIC(10,2);

UPDATE itens_venda iv
SET custo_unitario = p.custo
FROM produtos p
WHERE iv.produto_id = p.id
  AND iv.custo_unitario IS NULL;

ALTER TABLE itens_venda ALTER COLUMN custo_unitario SET NOT NULL;
ALTER TABLE itens_venda ADD CONSTRAINT itens_venda_custo_unitario_check CHECK (custo_unitario >= 0);
