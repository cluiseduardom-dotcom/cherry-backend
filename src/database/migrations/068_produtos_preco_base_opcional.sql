-- O preço de venda passa a ser definido por canal (precos_produto, "Precificar por canal"). Ao criar um
-- produto, só o custo é informado; produtos.preco_venda (preço base legado) fica NULL até alguém defini-lo.
-- A venda sempre usa o preço do canal; consultas de margem/alerta ignoram produtos sem preço base (NULL).
-- Migration só aditiva/relaxante: nenhum dado existente é alterado.

ALTER TABLE produtos ALTER COLUMN preco_venda DROP NOT NULL;
