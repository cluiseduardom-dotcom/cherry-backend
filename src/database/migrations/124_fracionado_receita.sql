-- 124: receita com rendimento e custo com mais casas decimais (módulo Fracionado, etapa 1).
--
-- Decisão do PO (21/11/2026): quantidades continuam INTEIRAS no banco. Produto fracionado guarda o estoque na menor
-- unidade (gramas, ml) e a tela converte para kg/L. Nada de decimal em estoque, venda ou ficha (menos risco para quem
-- já está em produção). O que muda aqui:
--  1) fichas_tecnicas.rendimento: quantas unidades do acabado UMA receita rende (padrão 1 = comportamento de sempre).
--     A quantidade de cada insumo na ficha passa a ser "por receita"; o consumo de N unidades é
--     ceil(quantidade × N ÷ rendimento) (src/utils/receita.js). Fichas existentes ficam com rendimento 1.
--  2) Custo por unidade-base precisa de mais casas (R$ 12,50/kg = R$ 0,0125/g não cabe em NUMERIC(10,2)):
--     produtos.custo, itens_compra.custo_unitario e os custos congelados de consumo e venda passam a NUMERIC(14,6).
--     Ampliação sem perda: os valores atuais não mudam (12.50 vira 12.500000).
-- Preço de venda (2 casas) não muda. Reversão manual no rodapé (só se nenhum custo usar mais de 2 casas).

ALTER TABLE fichas_tecnicas
    ADD COLUMN IF NOT EXISTS rendimento INTEGER NOT NULL DEFAULT 1
        CONSTRAINT fichas_tecnicas_rendimento_chk CHECK (rendimento > 0 AND rendimento <= 1000000);

ALTER TABLE produtos ALTER COLUMN custo TYPE NUMERIC(14, 6);
ALTER TABLE itens_compra ALTER COLUMN custo_unitario TYPE NUMERIC(14, 6);
ALTER TABLE venda_consumos ALTER COLUMN custo_unitario TYPE NUMERIC(14, 6);
ALTER TABLE consumos_avulsos ALTER COLUMN custo_unitario TYPE NUMERIC(14, 6);
ALTER TABLE itens_venda ALTER COLUMN custo_unitario TYPE NUMERIC(14, 6);

-- Reversão manual (não executada pelo runner; só vale se nenhum custo usar mais de 2 casas decimais):
--   ALTER TABLE itens_venda ALTER COLUMN custo_unitario TYPE NUMERIC(10, 2);
--   ALTER TABLE consumos_avulsos ALTER COLUMN custo_unitario TYPE NUMERIC(10, 2);
--   ALTER TABLE venda_consumos ALTER COLUMN custo_unitario TYPE NUMERIC(10, 2);
--   ALTER TABLE itens_compra ALTER COLUMN custo_unitario TYPE NUMERIC(10, 2);
--   ALTER TABLE produtos ALTER COLUMN custo TYPE NUMERIC(10, 2);
--   ALTER TABLE fichas_tecnicas DROP CONSTRAINT IF EXISTS fichas_tecnicas_rendimento_chk, DROP COLUMN IF EXISTS rendimento;
