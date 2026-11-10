-- Loja online — carrossel de novidades da página inicial: curadoria por peça.
--
-- * produtos_loja.carrossel_novidades: a peça foi escolhida (no ERP, em "Loja online") para aparecer no carrossel
--   de novidades da página inicial. Nasce falso. Se NENHUMA peça visível estiver escolhida, o carrossel mostra
--   automaticamente as peças que são novidade (regra de sempre: primeira entrada de estoque nos últimos 30 dias).
-- * Não altera produtos, preço, estoque nem nenhum contrato existente. Só acrescenta uma coluna com padrão falso.
--
-- Só acrescenta. Idempotente. Reversão manual no rodapé.

ALTER TABLE produtos_loja ADD COLUMN IF NOT EXISTS carrossel_novidades BOOLEAN NOT NULL DEFAULT false;

-- Reversão manual (não executada pelo runner; a API deixa de ler a coluna só depois de reverter o código):
--   ALTER TABLE produtos_loja DROP COLUMN IF EXISTS carrossel_novidades;
