-- Migration 017: kit_id em itens_venda.
-- PDV/vendas ganha a funcionalidade de "kit": um agrupamento de produtos já
-- existentes em estoque, montado do zero a cada venda (não há cadastro
-- prévio de kit) e vendido como uma linha única no carrinho/recibo do
-- frontend, mas gravado como linhas individuais em itens_venda — cada
-- componente já segue o fluxo normal de preco_unitario/custo_unitario
-- travados e baixa de estoque direta, sem produto virtual de kit.
--
-- kit_id é sequencial DENTRO da venda (1, 2, 3...), não um id global nem
-- referência a outra tabela — por isso é só um INTEGER NULL, sem FK. Itens
-- avulsos (fora de kit) ficam com kit_id NULL, igual toda venda existente
-- antes desta migration.
--
-- Sem índice: cardinalidade baixa por venda (poucos itens, poucos kits),
-- não há consulta que filtre por kit_id isoladamente.

ALTER TABLE itens_venda ADD COLUMN kit_id INTEGER NULL;
