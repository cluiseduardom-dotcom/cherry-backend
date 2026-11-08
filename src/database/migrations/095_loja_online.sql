-- Loja online (canal e-commerce) — fatia 1: marcação de produto e catálogo público.
--
-- * Funcionalidade `loja_online` (módulo) no catálogo de funcionalidades (089). Fica DESLIGADA para toda empresa:
--   nenhum plano a inclui, e a GiroNex a liga avulsa, empresa por empresa, no Painel. Sem ela, as rotas públicas
--   `/loja/:slug/*` respondem 404 e as rotas de gestão respondem 403.
-- * produtos_loja: quais produtos aparecem na loja e o texto editorial deles. NÃO altera `produtos`. Preço e estoque
--   continuam vindo do Vertumno (preço do canal `online`, saldo do local Central); aqui não há preço nem saldo.
--   `materiais` e `cuidados` nascem vazios: o sistema nunca preenche esses textos por conta própria.
--
-- Só acrescenta: nenhuma tabela, coluna, constraint ou contrato existente é alterado. Idempotente.
-- Reversão manual no rodapé.

INSERT INTO funcionalidades (codigo, nome, tipo, vendavel) VALUES
    ('loja_online', 'Loja online (e-commerce)', 'modulo', true)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS produtos_loja (
    produto_id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    -- Marcação: só produto visível entra na API pública. Nasce falso (opt-in explícito).
    visivel BOOLEAN NOT NULL DEFAULT false,
    -- Identificador público do produto na URL da loja; único por empresa. Gerado pelo backend.
    slug VARCHAR(160) NOT NULL,
    titulo VARCHAR(160),
    descricao TEXT,
    materiais TEXT,
    cuidados TEXT,
    ordem INTEGER NOT NULL DEFAULT 0,
    -- Primeira vez que ficou visível (base de auditoria; não é o critério de "Novidades").
    publicado_em TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A linha é sempre da mesma empresa do produto.
    CONSTRAINT produtos_loja_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
    CONSTRAINT produtos_loja_slug_uk UNIQUE (empresa_id, slug),
    CONSTRAINT produtos_loja_slug_chk CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE INDEX IF NOT EXISTS idx_produtos_loja_visiveis ON produtos_loja (empresa_id, ordem, produto_id) WHERE visivel;

-- Reversão manual (não executada pelo runner; antes, desligue `loja_online` das empresas):
--   DROP TABLE IF EXISTS produtos_loja;
--   DELETE FROM empresa_funcionalidades WHERE funcionalidade = 'loja_online';
--   DELETE FROM funcionalidades WHERE codigo = 'loja_online';
