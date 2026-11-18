-- Importação de lista, PR 2: confirmação (grava produtos/clientes/estoque inicial) e relatório.
--
-- * produtos.importacao_id e clientes.importacao_id: vínculo de cada registro criado à importação que o criou (auditoria).
--   Reversão em massa fica fora da v1; o vínculo deixa a porta aberta. Anuláveis: o legado e o cadastro manual ficam NULL.
-- * importacoes.relatorio: resultado linha a linha da confirmação (criado/ignorado, id, SKU, motivo). Sem dado pessoal:
--   cliente aparece só por número de linha e id. O relatório é a única coisa guardada depois da confirmação.
-- * importacoes.confirmada_por: quem confirmou (pode ser outro admin da empresa que fez a prévia).
-- * Só acrescenta. Idempotente. Reversão manual no rodapé.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS importacao_id INTEGER REFERENCES importacoes(id);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS importacao_id INTEGER REFERENCES importacoes(id);
ALTER TABLE importacoes ADD COLUMN IF NOT EXISTS relatorio JSONB;
ALTER TABLE importacoes ADD COLUMN IF NOT EXISTS confirmada_por INTEGER REFERENCES usuarios(id);

CREATE INDEX IF NOT EXISTS idx_produtos_importacao ON produtos (importacao_id) WHERE importacao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_importacao ON clientes (importacao_id) WHERE importacao_id IS NOT NULL;

-- Reversão manual (não executada pelo runner):
--   ALTER TABLE importacoes DROP COLUMN IF EXISTS confirmada_por;
--   ALTER TABLE importacoes DROP COLUMN IF EXISTS relatorio;
--   ALTER TABLE clientes DROP COLUMN IF EXISTS importacao_id;
--   ALTER TABLE produtos DROP COLUMN IF EXISTS importacao_id;
