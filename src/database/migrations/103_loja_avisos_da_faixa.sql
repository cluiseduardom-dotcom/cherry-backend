-- Loja online — faixa de avisos sob o banner da Home (frete, parcelamento, promoções... o que a loja decidir).
--
-- * loja_institucional.avisos: um aviso por linha (até 5, 100 caracteres cada, aparados no servidor). Nasce vazio:
--   o sistema nunca preenche aviso por conta própria, e a faixa só aparece na loja quando há aviso cadastrado.
-- * Só acrescenta uma coluna. Idempotente. Reversão manual no rodapé.

ALTER TABLE loja_institucional ADD COLUMN IF NOT EXISTS avisos TEXT;

-- Reversão manual (não executada pelo runner; a API deixa de ler a coluna só depois de reverter o código):
--   ALTER TABLE loja_institucional DROP COLUMN IF EXISTS avisos;
