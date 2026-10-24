-- Estoque por local (fatia 2): transferências entre locais com aceite.
--
-- Fluxo: ao criar, a mercadoria sai do local de origem e fica em "Em trânsito" (o total não muda).
-- Aceitar: sai do trânsito e entra no destino. Recusar ou cancelar: volta do trânsito para a origem.
-- Toda perna é uma movimentação de estoque normal (movimentacoes_estoque.transferencia_id a liga à
-- transferência). Toda transferência exige aceite; só existe um Central por empresa, então não há
-- transferência "automática" entre centrais.
--
-- transferencias_estoque muda de status (pendente -> concluida/recusada/cancelada); a trilha
-- transferencias_eventos é insert-only (o banco recusa UPDATE/DELETE), no mesmo padrão de usuarios_eventos.
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS transferencias_estoque (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    origem_local_id INTEGER NOT NULL,
    destino_local_id INTEGER NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'pendente',
    observacao TEXT,
    criado_por INTEGER NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    resolvido_por INTEGER,
    resolvido_em TIMESTAMP,
    motivo_resolucao TEXT,
    CONSTRAINT transferencias_estoque_status_chk CHECK (status IN ('pendente', 'concluida', 'recusada', 'cancelada')),
    CONSTRAINT transferencias_estoque_locais_chk CHECK (origem_local_id <> destino_local_id),
    CONSTRAINT transferencias_estoque_resolucao_chk CHECK (
        (status = 'pendente' AND resolvido_por IS NULL AND resolvido_em IS NULL)
        OR (status <> 'pendente' AND resolvido_por IS NOT NULL AND resolvido_em IS NOT NULL)
    ),
    CONSTRAINT transferencias_estoque_motivo_chk CHECK (
        status IN ('pendente', 'concluida') OR (motivo_resolucao IS NOT NULL AND length(btrim(motivo_resolucao)) >= 3)
    ),
    CONSTRAINT transferencias_estoque_origem_fk FOREIGN KEY (origem_local_id, empresa_id) REFERENCES locais_estoque (id, empresa_id),
    CONSTRAINT transferencias_estoque_destino_fk FOREIGN KEY (destino_local_id, empresa_id) REFERENCES locais_estoque (id, empresa_id),
    CONSTRAINT transferencias_estoque_criador_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT transferencias_estoque_resolvedor_fk FOREIGN KEY (resolvido_por, empresa_id) REFERENCES usuarios (id, empresa_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transferencias_estoque_id_empresa ON transferencias_estoque (id, empresa_id);
CREATE INDEX IF NOT EXISTS idx_transferencias_estoque_empresa_status ON transferencias_estoque (empresa_id, status, criado_em DESC);

CREATE TABLE IF NOT EXISTS transferencia_itens (
    transferencia_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    PRIMARY KEY (transferencia_id, produto_id),
    CONSTRAINT transferencia_itens_transferencia_fk FOREIGN KEY (transferencia_id, empresa_id) REFERENCES transferencias_estoque (id, empresa_id),
    CONSTRAINT transferencia_itens_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id)
);

CREATE TABLE IF NOT EXISTS transferencias_eventos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    transferencia_id INTEGER NOT NULL,
    acao VARCHAR(10) NOT NULL,
    executado_por INTEGER NOT NULL,
    motivo TEXT,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT transferencias_eventos_acao_chk CHECK (acao IN ('criar', 'aceitar', 'recusar', 'cancelar')),
    CONSTRAINT transferencias_eventos_motivo_chk CHECK (
        acao IN ('criar', 'aceitar') OR (motivo IS NOT NULL AND length(btrim(motivo)) >= 3)
    ),
    CONSTRAINT transferencias_eventos_transferencia_fk FOREIGN KEY (transferencia_id, empresa_id) REFERENCES transferencias_estoque (id, empresa_id),
    CONSTRAINT transferencias_eventos_executor_fk FOREIGN KEY (executado_por, empresa_id) REFERENCES usuarios (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_transferencias_eventos_transferencia ON transferencias_eventos (empresa_id, transferencia_id, id);

CREATE OR REPLACE FUNCTION transferencias_eventos_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'transferencias_eventos é imutável (% recusado)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transferencias_eventos_imutavel ON transferencias_eventos;
CREATE TRIGGER trg_transferencias_eventos_imutavel
    BEFORE UPDATE OR DELETE ON transferencias_eventos
    FOR EACH ROW EXECUTE FUNCTION transferencias_eventos_imutavel();

-- Liga cada movimentação de estoque à transferência que a gerou (NULL nas demais).
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS transferencia_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimentacoes_estoque_transferencia_fk') THEN
        ALTER TABLE movimentacoes_estoque
            ADD CONSTRAINT movimentacoes_estoque_transferencia_fk
            FOREIGN KEY (transferencia_id, empresa_id) REFERENCES transferencias_estoque (id, empresa_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_transferencia ON movimentacoes_estoque (empresa_id, transferencia_id) WHERE transferencia_id IS NOT NULL;

-- Reversão manual (não executada pelo runner):
--   ALTER TABLE movimentacoes_estoque DROP CONSTRAINT IF EXISTS movimentacoes_estoque_transferencia_fk;
--   ALTER TABLE movimentacoes_estoque DROP COLUMN IF EXISTS transferencia_id;
--   DROP TRIGGER IF EXISTS trg_transferencias_eventos_imutavel ON transferencias_eventos;
--   DROP FUNCTION IF EXISTS transferencias_eventos_imutavel();
--   DROP TABLE IF EXISTS transferencias_eventos; DROP TABLE IF EXISTS transferencia_itens; DROP TABLE IF EXISTS transferencias_estoque;
