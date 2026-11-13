-- Loja online — seção comercial da Home ("Escolha pelo quanto quer gastar" + "Últimas unidades" + ajuda por WhatsApp).
--
-- * home_vendas_ativo: liga a seção na Home. NASCE DESLIGADO: enquanto estiver desligado, a Home segue exatamente como hoje.
-- * home_*_titulo / home_*_texto: textos editáveis pelo ERP. Nascem vazios: a loja usa os textos padrão de interface
--   (sem promessa nenhuma) e só troca se o admin escrever outro.
-- * Só acrescenta colunas à tabela existente. Idempotente. Reversão manual no rodapé.

ALTER TABLE loja_institucional
    ADD COLUMN IF NOT EXISTS home_vendas_ativo     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS home_presentes_titulo VARCHAR(80),
    ADD COLUMN IF NOT EXISTS home_presentes_texto  VARCHAR(200),
    ADD COLUMN IF NOT EXISTS home_ultimas_titulo   VARCHAR(80),
    ADD COLUMN IF NOT EXISTS home_ultimas_texto    VARCHAR(200),
    ADD COLUMN IF NOT EXISTS home_ajuda_titulo     VARCHAR(80),
    ADD COLUMN IF NOT EXISTS home_ajuda_texto      VARCHAR(200);

-- Reversão manual (não executada pelo runner; só depois de reverter o código que lê as colunas):
--   ALTER TABLE loja_institucional
--       DROP COLUMN IF EXISTS home_vendas_ativo,
--       DROP COLUMN IF EXISTS home_presentes_titulo, DROP COLUMN IF EXISTS home_presentes_texto,
--       DROP COLUMN IF EXISTS home_ultimas_titulo,   DROP COLUMN IF EXISTS home_ultimas_texto,
--       DROP COLUMN IF EXISTS home_ajuda_titulo,     DROP COLUMN IF EXISTS home_ajuda_texto;
