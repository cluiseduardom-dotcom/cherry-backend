-- Estoque por local (fatia 3b): conferência (contagem física) de um local.
--   conferencias_estoque / conferencia_itens : registro IMUTÁVEL (insert-only) do que o sistema dizia
--   (saldo_sistema) e do que foi contado (quantidade_contada) em um local (Maleta, Consignado ou Central).
-- A conferência sozinha NÃO altera estoque. Quando o admin pede o ajuste, ele é feito pelo mesmo caminho
-- de sempre (movimentação `ajuste` no local) na mesma transação, e a conferência fica marcada com
-- ajuste_aplicado. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS conferencias_estoque (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    local_id INTEGER NOT NULL,
    criado_por INTEGER NOT NULL,
    observacao TEXT,
    ajuste_aplicado BOOLEAN NOT NULL DEFAULT false,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT conferencias_estoque_local_fk FOREIGN KEY (local_id, empresa_id) REFERENCES locais_estoque (id, empresa_id),
    CONSTRAINT conferencias_estoque_criador_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conferencias_estoque_id_empresa ON conferencias_estoque (id, empresa_id);
CREATE INDEX IF NOT EXISTS idx_conferencias_estoque_local ON conferencias_estoque (empresa_id, local_id, id DESC);

CREATE TABLE IF NOT EXISTS conferencia_itens (
    conferencia_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    saldo_sistema INTEGER NOT NULL CHECK (saldo_sistema >= 0),
    quantidade_contada INTEGER NOT NULL CHECK (quantidade_contada >= 0),
    diferenca INTEGER GENERATED ALWAYS AS (quantidade_contada - saldo_sistema) STORED,
    PRIMARY KEY (conferencia_id, produto_id),
    CONSTRAINT conferencia_itens_conferencia_fk FOREIGN KEY (conferencia_id, empresa_id) REFERENCES conferencias_estoque (id, empresa_id),
    CONSTRAINT conferencia_itens_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id)
);

CREATE OR REPLACE FUNCTION conferencias_estoque_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION '% é imutável (% recusado)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conferencias_estoque_imutavel ON conferencias_estoque;
CREATE TRIGGER trg_conferencias_estoque_imutavel
    BEFORE UPDATE OR DELETE ON conferencias_estoque
    FOR EACH ROW EXECUTE FUNCTION conferencias_estoque_imutavel();

DROP TRIGGER IF EXISTS trg_conferencia_itens_imutavel ON conferencia_itens;
CREATE TRIGGER trg_conferencia_itens_imutavel
    BEFORE UPDATE OR DELETE ON conferencia_itens
    FOR EACH ROW EXECUTE FUNCTION conferencias_estoque_imutavel();

-- Reversão manual (não executada pelo runner):
--   DROP TABLE IF EXISTS conferencia_itens; DROP TABLE IF EXISTS conferencias_estoque;
--   DROP FUNCTION IF EXISTS conferencias_estoque_imutavel();
