-- VERTUMNO SKU v2 (migration 024): padrões múltiplos, códigos flexíveis e sequência sem limite artificial de 3 dígitos.

ALTER TABLE configuracoes_sku
    ADD COLUMN IF NOT EXISTS padrao BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS idx_configuracoes_sku_ativa_empresa;

CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracoes_sku_padrao_empresa
    ON configuracoes_sku(empresa_id)
    WHERE ativo = true AND padrao = true;

UPDATE configuracoes_sku
SET padrao = true
WHERE ativo = true
  AND NOT EXISTS (
      SELECT 1
      FROM configuracoes_sku c2
      WHERE c2.empresa_id = configuracoes_sku.empresa_id
        AND c2.ativo = true
        AND c2.padrao = true
  );

ALTER TABLE categorias_produto
    ALTER COLUMN codigo TYPE VARCHAR(50);

ALTER TABLE produtos
    ALTER COLUMN sku TYPE VARCHAR(255);

ALTER TABLE configuracoes_sku
    ALTER COLUMN prefixo TYPE VARCHAR(50),
    ALTER COLUMN sufixo TYPE VARCHAR(50),
    ALTER COLUMN tamanho_sequencia SET DEFAULT 3;

ALTER TABLE configuracoes_sku
    DROP CONSTRAINT IF EXISTS configuracoes_sku_tamanho_sequencia_check;

ALTER TABLE configuracoes_sku
    ADD CONSTRAINT configuracoes_sku_tamanho_sequencia_check
    CHECK (tamanho_sequencia BETWEEN 1 AND 18);

ALTER TABLE configuracoes_sku
    ALTER COLUMN inicio_sequencia TYPE BIGINT;

ALTER TABLE sequencias_sku
    ALTER COLUMN contador TYPE BIGINT;

ALTER TABLE categorias_produto
    ADD COLUMN IF NOT EXISTS configuracao_sku_id INTEGER
        REFERENCES configuracoes_sku(id);

CREATE INDEX IF NOT EXISTS idx_categorias_produto_configuracao_sku
    ON categorias_produto(configuracao_sku_id);

COMMENT ON COLUMN configuracoes_sku.padrao IS
    'Define o padrão de SKU usado quando nenhuma categoria vinculada ao produto possui um padrão específico.';

COMMENT ON COLUMN categorias_produto.configuracao_sku_id IS
    'Padrão de SKU específico desta categoria. Permite que a mesma empresa mantenha padrões diferentes por linha/segmento de produto.';
