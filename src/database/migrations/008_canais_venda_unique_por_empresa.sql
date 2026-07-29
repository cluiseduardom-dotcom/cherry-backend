-- canais_venda.nome era UNIQUE globalmente (herdado de antes do multi-tenant,
-- migration 007 adicionou empresa_id mas não tocou nessa constraint). Isso
-- travava qualquer empresa além da primeira: como não existe endpoint pra
-- criar canais_venda, e os dois canais padrão ('loja_fisica', 'online') já
-- pertencem à empresa 1, nenhuma segunda empresa conseguia ter um canal com
-- esses nomes — o que quebra produtos (listagem depende de resolver canal),
-- vendas (PDV precisa de canal pra travar preço) e precificação inteiros para
-- qualquer empresa nova. Duas empresas diferentes podem (e devem poder) ter
-- um canal chamado "loja_fisica" sem conflito, então a unicidade passa a ser
-- por (empresa_id, nome).

ALTER TABLE canais_venda DROP CONSTRAINT IF EXISTS canais_venda_nome_key;
ALTER TABLE canais_venda ADD CONSTRAINT canais_venda_empresa_id_nome_key UNIQUE (empresa_id, nome);
