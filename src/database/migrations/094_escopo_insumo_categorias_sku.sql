-- Insumos com categorização e SKU próprios (PO, 07/11/2026): categorias, rótulos de nível e padrões de SKU
-- passam a ter `escopo` ('produto' | 'insumo'). Tudo que já existe é 'produto'. Cada empresa ganha, no escopo
-- insumo, um padrão de SKU (Família obrigatória + Tamanho opcional), os rótulos dos níveis e as famílias
-- iniciais EMB (Embalagem), ETQ (Etiqueta / Tag) e MAT (Material), editáveis pela própria empresa.
-- Aditiva e idempotente. Reversão manual: remover as linhas de escopo 'insumo' e as colunas `escopo`, e recriar
-- os índices/constraint sem `escopo`.

ALTER TABLE categorias_produto ADD COLUMN IF NOT EXISTS escopo VARCHAR(10) NOT NULL DEFAULT 'produto';
ALTER TABLE niveis_categoria ADD COLUMN IF NOT EXISTS escopo VARCHAR(10) NOT NULL DEFAULT 'produto';
ALTER TABLE configuracoes_sku ADD COLUMN IF NOT EXISTS escopo VARCHAR(10) NOT NULL DEFAULT 'produto';

ALTER TABLE categorias_produto DROP CONSTRAINT IF EXISTS categorias_produto_escopo_chk;
ALTER TABLE categorias_produto ADD CONSTRAINT categorias_produto_escopo_chk CHECK (escopo IN ('produto', 'insumo'));
ALTER TABLE niveis_categoria DROP CONSTRAINT IF EXISTS niveis_categoria_escopo_chk;
ALTER TABLE niveis_categoria ADD CONSTRAINT niveis_categoria_escopo_chk CHECK (escopo IN ('produto', 'insumo'));
ALTER TABLE configuracoes_sku DROP CONSTRAINT IF EXISTS configuracoes_sku_escopo_chk;
ALTER TABLE configuracoes_sku ADD CONSTRAINT configuracoes_sku_escopo_chk CHECK (escopo IN ('produto', 'insumo'));

-- Unicidade passa a valer dentro do escopo (o código EMB de insumo não colide com um código de produto).
DROP INDEX IF EXISTS idx_categorias_produto_codigo_unico;
CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_produto_codigo_unico
    ON categorias_produto (empresa_id, escopo, nivel, UPPER(codigo))
    WHERE deletado_em IS NULL;

ALTER TABLE niveis_categoria DROP CONSTRAINT IF EXISTS niveis_categoria_empresa_id_nivel_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_niveis_categoria_escopo_nivel ON niveis_categoria (empresa_id, escopo, nivel);

DROP INDEX IF EXISTS idx_configuracoes_sku_padrao_empresa;
CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracoes_sku_padrao_empresa
    ON configuracoes_sku (empresa_id, escopo)
    WHERE ativo = true AND padrao = true;

-- Padrão de SKU de insumos para cada empresa que ainda não tem.
INSERT INTO configuracoes_sku (empresa_id, nome, tipo_sku, separador, prefixo, sufixo, tamanho_sequencia, inicio_sequencia, ativo, padrao, escopo)
SELECT e.id, 'Insumos', 'numerico', '-', '', '', 3, 1, true, true, 'insumo'
FROM empresas e
WHERE NOT EXISTS (
    SELECT 1 FROM configuracoes_sku c WHERE c.empresa_id = e.id AND c.escopo = 'insumo' AND c.ativo = true AND c.padrao = true
);

INSERT INTO configuracoes_sku_segmentos (configuracao_id, nivel, ordem, nome, obrigatorio, participa_sku)
SELECT c.id, s.nivel, s.nivel, s.nome, s.obrigatorio, true
FROM configuracoes_sku c
CROSS JOIN (VALUES (1, 'Família', true), (2, 'Tamanho', false)) AS s(nivel, nome, obrigatorio)
WHERE c.escopo = 'insumo' AND c.ativo = true AND c.padrao = true
  AND NOT EXISTS (SELECT 1 FROM configuracoes_sku_segmentos x WHERE x.configuracao_id = c.id);

INSERT INTO niveis_categoria (empresa_id, nivel, nome, escopo)
SELECT e.id, s.nivel, s.nome, 'insumo'
FROM empresas e
CROSS JOIN (VALUES (1, 'Família'), (2, 'Tamanho')) AS s(nivel, nome)
WHERE NOT EXISTS (SELECT 1 FROM niveis_categoria n WHERE n.empresa_id = e.id AND n.escopo = 'insumo' AND n.nivel = s.nivel);

INSERT INTO categorias_produto (empresa_id, nivel, codigo, nome, configuracao_sku_id, escopo)
SELECT c.empresa_id, 1, f.codigo, f.nome, c.id, 'insumo'
FROM configuracoes_sku c
CROSS JOIN (VALUES ('EMB', 'Embalagem'), ('ETQ', 'Etiqueta / Tag'), ('MAT', 'Material')) AS f(codigo, nome)
WHERE c.escopo = 'insumo' AND c.ativo = true AND c.padrao = true
  AND NOT EXISTS (
      SELECT 1 FROM categorias_produto x
      WHERE x.empresa_id = c.empresa_id AND x.escopo = 'insumo' AND x.nivel = 1 AND UPPER(x.codigo) = f.codigo AND x.deletado_em IS NULL
  );
