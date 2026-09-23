-- Configuração de SKU por empresa.
-- Mantém compatibilidade com o modelo anterior de categorias/níveis e prepara
-- o motor de SKU para formatos configuráveis, múltiplas dimensões e auditoria.

CREATE TABLE IF NOT EXISTS configuracoes_sku (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nome VARCHAR(100) NOT NULL,
    tipo_sku VARCHAR(20) NOT NULL DEFAULT 'alfanumerico'
        CHECK (tipo_sku IN ('numerico','alfabetico','alfanumerico')),
    separador VARCHAR(1) NOT NULL DEFAULT '',
    prefixo VARCHAR(30) NOT NULL DEFAULT '',
    sufixo VARCHAR(30) NOT NULL DEFAULT '',
    tamanho_sequencia SMALLINT NOT NULL DEFAULT 3
        CHECK (tamanho_sequencia BETWEEN 1 AND 9),
    inicio_sequencia INTEGER NOT NULL DEFAULT 1
        CHECK (inicio_sequencia >= 0),
    ativo BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_configuracoes_sku_empresa_id
    ON configuracoes_sku(empresa_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracoes_sku_ativa_empresa
    ON configuracoes_sku(empresa_id)
    WHERE ativo = true;

CREATE TABLE IF NOT EXISTS configuracoes_sku_segmentos (
    id SERIAL PRIMARY KEY,
    configuracao_id INTEGER NOT NULL REFERENCES configuracoes_sku(id) ON DELETE CASCADE,
    nivel INTEGER NOT NULL CHECK (nivel > 0),
    ordem INTEGER NOT NULL CHECK (ordem > 0),
    nome VARCHAR(255) NOT NULL,
    obrigatorio BOOLEAN NOT NULL DEFAULT true,
    participa_sku BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (configuracao_id, nivel),
    UNIQUE (configuracao_id, ordem)
);

CREATE INDEX IF NOT EXISTS idx_configuracoes_sku_segmentos_configuracao
    ON configuracoes_sku_segmentos(configuracao_id);

CREATE TABLE IF NOT EXISTS historico_sku (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    sku VARCHAR(100) NOT NULL,
    configuracao_id INTEGER REFERENCES configuracoes_sku(id),
    usuario_id INTEGER REFERENCES usuarios(id),
    acao VARCHAR(20) NOT NULL
        CHECK (acao IN ('gerado','alterado','legado')),
    sku_anterior VARCHAR(100),
    motivo TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historico_sku_empresa_id
    ON historico_sku(empresa_id);

CREATE INDEX IF NOT EXISTS idx_historico_sku_produto_id
    ON historico_sku(produto_id);

CREATE INDEX IF NOT EXISTS idx_historico_sku_sku
    ON historico_sku(empresa_id, sku);

-- Cada empresa existente recebe uma configuração inicial equivalente ao
-- comportamento anterior: alfanumérico, sem separador e sequência de 3 dígitos.
INSERT INTO configuracoes_sku (
    empresa_id, nome, tipo_sku, separador, prefixo, sufixo,
    tamanho_sequencia, inicio_sequencia, ativo
)
SELECT e.id, 'Padrão atual', 'alfanumerico', '', '', '', 3, 1, true
FROM empresas e
WHERE NOT EXISTS (
    SELECT 1
    FROM configuracoes_sku c
    WHERE c.empresa_id = e.id
      AND c.ativo = true
);

-- Cada nível já existente passa a ser um segmento da configuração padrão.
INSERT INTO configuracoes_sku_segmentos (
    configuracao_id, nivel, ordem, nome, obrigatorio, participa_sku
)
SELECT
    c.id,
    niveis.nivel,
    ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY niveis.nivel),
    COALESCE(
        (SELECT nc.nome
         FROM niveis_categoria nc
         WHERE nc.empresa_id = c.empresa_id
           AND nc.nivel = niveis.nivel
         LIMIT 1),
        'Nível ' || niveis.nivel
    ),
    true,
    true
FROM configuracoes_sku c
JOIN (
    SELECT DISTINCT empresa_id, nivel FROM niveis_categoria
    UNION
    SELECT DISTINCT empresa_id, nivel FROM categorias_produto
) niveis ON niveis.empresa_id = c.empresa_id
WHERE c.ativo = true
  AND NOT EXISTS (
      SELECT 1
      FROM configuracoes_sku_segmentos s
      WHERE s.configuracao_id = c.id
        AND s.nivel = niveis.nivel
  );

-- A sequência antiga passa a pertencer explicitamente à configuração padrão.
ALTER TABLE sequencias_sku
    ADD COLUMN IF NOT EXISTS configuracao_id INTEGER
        REFERENCES configuracoes_sku(id);

UPDATE sequencias_sku s
SET configuracao_id = c.id
FROM configuracoes_sku c
WHERE c.empresa_id = s.empresa_id
  AND c.ativo = true
  AND s.configuracao_id IS NULL;

ALTER TABLE sequencias_sku
    ALTER COLUMN configuracao_id SET NOT NULL;

DROP INDEX IF EXISTS sequencias_sku_empresa_id_chave_combinacao_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sequencias_sku_empresa_config_combinacao
    ON sequencias_sku(empresa_id, configuracao_id, chave_combinacao);

-- Registra os SKUs existentes como legado para preservar rastreabilidade.
INSERT INTO historico_sku (
    empresa_id, produto_id, sku, configuracao_id, usuario_id, acao, motivo
)
SELECT
    p.empresa_id,
    p.id,
    p.sku,
    c.id,
    NULL,
    'legado',
    'SKU existente antes da configuração de SKU v1'
FROM produtos p
JOIN configuracoes_sku c
    ON c.empresa_id = p.empresa_id
   AND c.ativo = true
WHERE p.sku IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM historico_sku h
      WHERE h.produto_id = p.id
        AND h.sku = p.sku
        AND h.acao = 'legado'
  );
