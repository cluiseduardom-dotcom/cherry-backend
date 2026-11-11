-- Loja online — "Destaque" da Home: a peça do momento, escolhida pela loja (no ERP, em "Loja online").
--
-- * produtos_loja.destaque_home: a peça escolhida para a cena "Destaque" da página inicial. Nasce falso.
-- * No máximo UMA peça por empresa (índice único parcial): escolher outra tira a anterior (feito na mesma transação).
-- * Se nenhuma peça estiver escolhida, a Home usa a peça que já usava (a primeira disponível com foto).
-- * Não altera produtos, preço, estoque nem nenhum contrato existente. Só acrescenta uma coluna e um índice.
--
-- Só acrescenta. Idempotente. Reversão manual no rodapé.

ALTER TABLE produtos_loja ADD COLUMN IF NOT EXISTS destaque_home BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_loja_destaque_home ON produtos_loja (empresa_id) WHERE destaque_home;

-- Reversão manual (não executada pelo runner; a API deixa de ler a coluna só depois de reverter o código):
--   DROP INDEX IF EXISTS uq_produtos_loja_destaque_home;
--   ALTER TABLE produtos_loja DROP COLUMN IF EXISTS destaque_home;
