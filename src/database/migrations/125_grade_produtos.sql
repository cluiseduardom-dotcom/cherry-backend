-- 125: grade de produtos (variações de tamanho, cor etc. do mesmo produto) e a funcionalidade `grade` ligável.
--
-- Desenho (decisão de menor risco): cada variação é um PRODUTO NORMAL (SKU, estoque, preço, fotos e vendas próprios),
-- apenas ligado a uma grade e com os valores da variação. Estoque, PDV, vendas e financeiro não mudam; quem precisa
-- agrupar lê `grade_id` e `variacao`. Produto sem grade segue exatamente como era (as duas colunas ficam nulas).
--   grades_produto : o "produto pai" (nome, descrição) e os eixos da grade (ex.: ["Tamanho", "Cor"]).
--   produtos.grade_id / produtos.variacao : a qual grade pertence e quais valores ({"Tamanho": "P", "Cor": "Azul"}).
-- Uma combinação de valores não se repete dentro da mesma grade. FKs compostas com empresa_id.
-- A funcionalidade `grade` (catálogo da migration 089) passa a poder ser ligada pela GiroNex (vendavel = true);
-- nenhum plano a inclui. Idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS grades_produto (
    id            SERIAL PRIMARY KEY,
    empresa_id    INTEGER      NOT NULL REFERENCES empresas (id),
    nome          VARCHAR(255) NOT NULL,
    descricao     VARCHAR(1000),
    eixos         JSONB        NOT NULL,
    -- Padrões herdados por cada variação nova (a variação pode ter custo próprio). Categorias comuns a todas
    -- as variações (ex.: o Tipo) ficam aqui só para acrescentar variações depois sem informá-las de novo.
    custo         NUMERIC(14, 6) NOT NULL,
    preco_venda   NUMERIC(10, 2),
    unidade       VARCHAR(4)   NOT NULL DEFAULT 'UN',
    estoque_minimo INTEGER     NOT NULL DEFAULT 0,
    categorias_comuns JSONB    NOT NULL DEFAULT '[]'::jsonb,
    criado_por    INTEGER,
    criado_em     TIMESTAMP    NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT grades_produto_criado_por_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT grades_produto_eixos_chk CHECK (jsonb_typeof(eixos) = 'array' AND jsonb_array_length(eixos) BETWEEN 1 AND 3),
    CONSTRAINT grades_produto_custo_chk CHECK (custo > 0),
    CONSTRAINT grades_produto_estoque_minimo_chk CHECK (estoque_minimo >= 0),
    CONSTRAINT grades_produto_categorias_chk CHECK (jsonb_typeof(categorias_comuns) = 'array'),
    CONSTRAINT grades_produto_id_empresa_uk UNIQUE (id, empresa_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_produto_nome_unico ON grades_produto (empresa_id, lower(nome));

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS grade_id INTEGER;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS variacao JSONB;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produtos_grade_fk') THEN
        ALTER TABLE produtos
            ADD CONSTRAINT produtos_grade_fk FOREIGN KEY (grade_id, empresa_id) REFERENCES grades_produto (id, empresa_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produtos_variacao_chk') THEN
        ALTER TABLE produtos
            ADD CONSTRAINT produtos_variacao_chk CHECK (
                (grade_id IS NULL AND variacao IS NULL)
                OR (grade_id IS NOT NULL AND variacao IS NOT NULL AND jsonb_typeof(variacao) = 'object')
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_grade_variacao_unica ON produtos (grade_id, variacao) WHERE grade_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_produtos_grade ON produtos (empresa_id, grade_id) WHERE grade_id IS NOT NULL;

UPDATE funcionalidades SET vendavel = true WHERE codigo = 'grade';

-- Reversão manual (não executada pelo runner; só vale se nenhuma grade foi criada):
--   UPDATE funcionalidades SET vendavel = false WHERE codigo = 'grade';
--   DROP INDEX IF EXISTS idx_produtos_grade; DROP INDEX IF EXISTS idx_produtos_grade_variacao_unica;
--   ALTER TABLE produtos DROP CONSTRAINT IF EXISTS produtos_variacao_chk, DROP CONSTRAINT IF EXISTS produtos_grade_fk,
--       DROP COLUMN IF EXISTS variacao, DROP COLUMN IF EXISTS grade_id;
--   DROP TABLE IF EXISTS grades_produto;
