-- Categorias de produto configuráveis por empresa (nível = posição no SKU,
-- ex.: nível 1 = família, nível 2 = material) + geração automática de SKU.
-- Ver docs/superpowers/specs/2026-09-12-categorias-sku-design.md.

CREATE TABLE IF NOT EXISTS categorias_produto (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nivel INTEGER NOT NULL CHECK (nivel > 0),
    codigo VARCHAR(3) NOT NULL,
    nome VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    deletado_em TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categorias_produto_empresa_id ON categorias_produto(empresa_id);

-- Único por (empresa, nível, código em maiúsculas) entre categorias ativas.
-- Código PODE ser reaproveitado depois que a categoria antiga é soft-deletada
-- — seguro porque a sequência de SKU (ver sequencias_sku) é ancorada no TEXTO
-- do código, não no id: uma categoria nova com o mesmo código continua a
-- mesma sequência em vez de reiniciar e colidir. codigo/nivel são imutáveis
-- após a criação (aplicação, não constraint) — exatamente para não reabrir
-- esse mesmo risco de colisão por edição.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_produto_codigo_unico
    ON categorias_produto (empresa_id, nivel, UPPER(codigo))
    WHERE deletado_em IS NULL;

-- Vínculo produto <-> categoria. Tabela de junção necessária porque o número
-- de níveis é configurável por empresa (não fixo) — não dá pra representar
-- isso com colunas fixas categoria_nivel1_id/categoria_nivel2_id em produtos.
-- Deletar uma categoria (soft delete) NÃO apaga vínculos existentes nem afeta
-- SKUs já gerados.
CREATE TABLE IF NOT EXISTS produtos_categorias (
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    categoria_id INTEGER NOT NULL REFERENCES categorias_produto(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    PRIMARY KEY (produto_id, categoria_id)
);

CREATE INDEX IF NOT EXISTS idx_produtos_categorias_produto_id ON produtos_categorias(produto_id);

-- Contador atômico por combinação de códigos de categoria, isolado por
-- empresa. chave_combinacao = códigos das categorias atribuídas (maiúsculo),
-- ordenados por nível ascendente, unidos por "-" (ex.: "BR-01"). Upsert
-- (INSERT ... ON CONFLICT DO UPDATE) garante atomicidade sem lock explícito.
CREATE TABLE IF NOT EXISTS sequencias_sku (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    chave_combinacao VARCHAR(255) NOT NULL,
    contador INTEGER NOT NULL DEFAULT 0,
    UNIQUE (empresa_id, chave_combinacao)
);

-- sku deixa de ser único GLOBALMENTE e vira único POR EMPRESA (nullable já
-- era o caso — migration 002 nunca adicionou NOT NULL). Isso reverte,
-- deliberadamente, a decisão preservada na migration 007 ("produtos.sku
-- continua único globalmente, não por empresa") — motivo documentado no
-- CLAUDE.md: com SKU sempre gerado a partir de uma sequência isolada por
-- empresa, manter unicidade global bloquearia uma empresa de gerar um SKU só
-- porque outra empresa, sem nenhuma relação, gerou o mesmo texto antes.
ALTER TABLE produtos DROP CONSTRAINT IF EXISTS produtos_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_sku_unico
    ON produtos (empresa_id, sku)
    WHERE sku IS NOT NULL;

COMMENT ON COLUMN produtos.categoria IS
    'Deprecado: campo de texto livre substituído pela categorização estruturada (categorias_produto/produtos_categorias). Não ler nem escrever em código novo. Remoção planejada para uma etapa futura, antes do carregamento do catálogo real.';
