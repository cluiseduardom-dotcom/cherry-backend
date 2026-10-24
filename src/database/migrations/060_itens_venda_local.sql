-- Estoque por local (fatia 3): cada item de venda registra de QUAL local saiu a mercadoria.
-- É o que permite o cancelamento devolver ao local original (Maleta ou Central).
--
-- Backfill: toda venda anterior saiu do Central. O NOT NULL fica protegido por um gatilho de
-- INSERT que, se o local não vier informado, usa o Central da empresa. Isso mantém seguro o período
-- de deploy (código antigo ainda inserindo itens sem local) e qualquer importação futura; o código
-- novo sempre informa o local explicitamente. Aditiva e idempotente.

ALTER TABLE itens_venda ADD COLUMN IF NOT EXISTS local_id INTEGER;

UPDATE itens_venda iv
SET local_id = l.id
FROM locais_estoque l
WHERE iv.local_id IS NULL AND l.empresa_id = iv.empresa_id AND l.tipo = 'central';

CREATE OR REPLACE FUNCTION itens_venda_local_padrao() RETURNS trigger AS $$
BEGIN
    IF NEW.local_id IS NULL THEN
        INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES (NEW.empresa_id, 'central', 'Central')
        ON CONFLICT DO NOTHING;

        SELECT id INTO NEW.local_id FROM locais_estoque WHERE empresa_id = NEW.empresa_id AND tipo = 'central';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_itens_venda_local_padrao ON itens_venda;
CREATE TRIGGER trg_itens_venda_local_padrao
    BEFORE INSERT ON itens_venda
    FOR EACH ROW EXECUTE FUNCTION itens_venda_local_padrao();

ALTER TABLE itens_venda ALTER COLUMN local_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'itens_venda_local_fk') THEN
        ALTER TABLE itens_venda
            ADD CONSTRAINT itens_venda_local_fk
            FOREIGN KEY (local_id, empresa_id) REFERENCES locais_estoque (id, empresa_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_itens_venda_local ON itens_venda (empresa_id, local_id);

-- Reversão manual (não executada pelo runner):
--   DROP TRIGGER IF EXISTS trg_itens_venda_local_padrao ON itens_venda;
--   DROP FUNCTION IF EXISTS itens_venda_local_padrao();
--   ALTER TABLE itens_venda DROP CONSTRAINT IF EXISTS itens_venda_local_fk;
--   ALTER TABLE itens_venda DROP COLUMN IF EXISTS local_id;
