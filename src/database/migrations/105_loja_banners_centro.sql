-- Loja online — faixa rotativa com imagem CENTRAL (foto dos itens no meio, texto dos lados), além das imagens esquerda e direita.
--
-- * loja_banners.imagem_centro_chave: a foto dos itens da promoção, no centro da faixa. Quando existe, a faixa usa o layout
--   "texto | foto dos itens | destaque e botão" e as imagens laterais não são usadas.
-- * Faixa ativa continua exigindo algum conteúdo; a imagem central conta como conteúdo.
-- * Só acrescenta uma coluna e refaz a regra de "ativo exige conteúdo" incluindo a nova imagem. Idempotente. Reversão no rodapé.

ALTER TABLE loja_banners ADD COLUMN IF NOT EXISTS imagem_centro_chave VARCHAR(300);

ALTER TABLE loja_banners DROP CONSTRAINT IF EXISTS loja_banners_ativo_chk;
ALTER TABLE loja_banners ADD CONSTRAINT loja_banners_ativo_chk CHECK (NOT ativo OR usa_retrato OR titulo IS NOT NULL OR destaque IS NOT NULL OR subtitulo IS NOT NULL
    OR imagem_esquerda_chave IS NOT NULL OR imagem_direita_chave IS NOT NULL OR imagem_centro_chave IS NOT NULL);

-- Reversão manual (não executada pelo runner; antes, tire a imagem central das faixas ativas que só têm ela):
--   ALTER TABLE loja_banners DROP CONSTRAINT IF EXISTS loja_banners_ativo_chk;
--   ALTER TABLE loja_banners ADD CONSTRAINT loja_banners_ativo_chk CHECK (NOT ativo OR usa_retrato OR titulo IS NOT NULL OR destaque IS NOT NULL OR subtitulo IS NOT NULL
--       OR imagem_esquerda_chave IS NOT NULL OR imagem_direita_chave IS NOT NULL);
--   ALTER TABLE loja_banners DROP COLUMN IF EXISTS imagem_centro_chave;
