-- Migration 045: corretiva. Bancos tratados como "legados" pelo migrate.js
-- (schema_migrations vazia) tiveram as migrations 002-018 registradas como
-- aplicadas sem execução (baseline). Onde o banco era mais antigo que a 017/018,
-- faltam itens_venda.kit_id e produtos.unidade (caso do staging).
--
-- Idempotente e sem efeito sobre dados: não faz UPDATE/DELETE/DROP, não toca em
-- schema_migrations e é no-op onde as colunas já existem (ex.: produção).
-- Definições idênticas às de 017 e 018.

ALTER TABLE itens_venda ADD COLUMN IF NOT EXISTS kit_id INTEGER NULL;

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS unidade VARCHAR(4) NOT NULL DEFAULT 'UN';

-- Garante que, se a coluna JÁ existia, ela tem a definição esperada
-- (ADD COLUMN IF NOT EXISTS pularia silenciosamente uma definição errada).
DO $$
DECLARE
    v_tipo    text;
    v_nulo    text;
    v_default text;
    v_tam     integer;
BEGIN
    SELECT data_type, is_nullable INTO v_tipo, v_nulo
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'itens_venda' AND column_name = 'kit_id';

    IF v_tipo IS DISTINCT FROM 'integer' OR v_nulo IS DISTINCT FROM 'YES' THEN
        RAISE EXCEPTION 'itens_venda.kit_id com definição inesperada (tipo=%, nullable=%)', v_tipo, v_nulo;
    END IF;

    SELECT data_type, is_nullable, column_default, character_maximum_length
      INTO v_tipo, v_nulo, v_default, v_tam
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'produtos' AND column_name = 'unidade';

    IF v_tipo IS DISTINCT FROM 'character varying'
       OR v_nulo IS DISTINCT FROM 'NO'
       OR v_default IS NULL OR v_default NOT LIKE '''UN''%' THEN
        RAISE EXCEPTION 'produtos.unidade com definição inesperada (tipo=%, nullable=%, default=%)', v_tipo, v_nulo, v_default;
    END IF;

    IF v_tam IS DISTINCT FROM 4 THEN
        RAISE WARNING 'produtos.unidade tem tamanho % (esperado 4)', v_tam;
    END IF;
END $$;
