-- Loja online — faixas (banners) rotativas da Home, geridas pelo ERP: promoções, recados e fotos de peças.
--
-- * loja_banners: até 6 faixas por empresa, com rótulo, título, destaque, subtítulo, botão com link, rodapé, cor de fundo, duas
--   imagens opcionais (esquerda e direita) e janela de datas opcional (promoção com início e fim). `usa_retrato`: a faixa leva
--   o retrato do dia (pessoa com autorização de uso de imagem, gerida em "Retratos da Home") no lado esquerdo.
-- * Nasce INATIVA e VAZIA: o sistema nunca preenche promoção, texto ou imagem por conta própria. Só vai à loja a faixa ativa, com
--   conteúdo e dentro da janela de datas. Sem nenhuma faixa ativa, a Home usa a abertura de sempre.
-- * Remover = removido_em (a linha fica) + as imagens saem do armazenamento.
-- * Só acrescenta: nenhuma tabela, coluna ou contrato existente é alterado. Idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS loja_banners (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    ordem INTEGER NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT false,
    usa_retrato BOOLEAN NOT NULL DEFAULT false,
    fundo VARCHAR(12) NOT NULL DEFAULT 'vinho',
    rotulo VARCHAR(40),
    titulo VARCHAR(100),
    destaque VARCHAR(40),
    subtitulo VARCHAR(120),
    botao_texto VARCHAR(30),
    link VARCHAR(300),
    rodape_texto VARCHAR(100),
    imagem_esquerda_chave VARCHAR(300),
    imagem_direita_chave VARCHAR(300),
    inicio_em TIMESTAMPTZ,
    fim_em TIMESTAMPTZ,
    criado_por INTEGER,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removido_em TIMESTAMPTZ,
    CONSTRAINT loja_banners_fundo_chk CHECK (fundo IN ('vinho', 'ouro', 'rosa', 'escuro')),
    CONSTRAINT loja_banners_janela_chk CHECK (inicio_em IS NULL OR fim_em IS NULL OR fim_em > inicio_em),
    CONSTRAINT loja_banners_botao_chk CHECK (botao_texto IS NULL OR link IS NOT NULL),
    -- Só pode estar ativa uma faixa que tem o que mostrar.
    CONSTRAINT loja_banners_ativo_chk CHECK (NOT ativo OR usa_retrato OR titulo IS NOT NULL OR destaque IS NOT NULL OR subtitulo IS NOT NULL
        OR imagem_esquerda_chave IS NOT NULL OR imagem_direita_chave IS NOT NULL),
    CONSTRAINT loja_banners_criado_por_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_loja_banners_empresa ON loja_banners (empresa_id, ordem, id) WHERE removido_em IS NULL;

-- Reversão manual (não executada pelo runner; antes, desligue o uso no código):
--   DROP TABLE IF EXISTS loja_banners;
