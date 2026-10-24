-- Estoque por local (fatia 1): locais de estoque e saldo por produto e local.
--
-- Modelo:
--   locais_estoque : onde a mercadoria está (central, maleta de um usuário, consignado de um
--                    consignatário, em trânsito). Por empresa.
--   estoque_locais : saldo por (produto, local), nunca negativo.
--   produtos.estoque_atual continua sendo o TOTAL e é atualizado na mesma transação, pela mesma
--   função (estoqueRepository.criarMovimentacao). Invariante: soma dos saldos por local = estoque_atual.
--   movimentacoes_estoque ganha local_id e saldo_local_resultante.
--
-- Esta fatia NÃO muda comportamento visível: todo o saldo existente vai para o local Central e
-- todas as movimentações atuais passam a apontar para ele. Idempotente.
-- A movimentacoes_estoque NÃO vira insert-only aqui: comprasRepository ainda faz UPDATE de
-- compra_id em linha já inserida (fica para uma fatia própria).

CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_id_empresa ON produtos (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_id_empresa ON clientes (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_id_empresa ON usuarios (id, empresa_id);

CREATE TABLE IF NOT EXISTS locais_estoque (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    tipo VARCHAR(12) NOT NULL,
    nome VARCHAR(100) NOT NULL,
    usuario_id INTEGER,
    cliente_id INTEGER,
    ativo BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT locais_estoque_tipo_chk CHECK (tipo IN ('central', 'maleta', 'consignado', 'transito')),
    CONSTRAINT locais_estoque_dono_chk CHECK (
        (tipo = 'maleta' AND usuario_id IS NOT NULL AND cliente_id IS NULL)
        OR (tipo = 'consignado' AND usuario_id IS NULL)
        OR (tipo IN ('central', 'transito') AND usuario_id IS NULL AND cliente_id IS NULL)
    ),
    CONSTRAINT locais_estoque_usuario_fk FOREIGN KEY (usuario_id, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT locais_estoque_cliente_fk FOREIGN KEY (cliente_id, empresa_id) REFERENCES clientes (id, empresa_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_locais_estoque_id_empresa ON locais_estoque (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_locais_estoque_central ON locais_estoque (empresa_id) WHERE tipo = 'central';
CREATE UNIQUE INDEX IF NOT EXISTS uq_locais_estoque_transito ON locais_estoque (empresa_id) WHERE tipo = 'transito';
CREATE UNIQUE INDEX IF NOT EXISTS uq_locais_estoque_maleta ON locais_estoque (empresa_id, usuario_id) WHERE tipo = 'maleta';
CREATE UNIQUE INDEX IF NOT EXISTS uq_locais_estoque_consignado ON locais_estoque (empresa_id, cliente_id) WHERE tipo = 'consignado' AND cliente_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS estoque_locais (
    produto_id INTEGER NOT NULL,
    local_id INTEGER NOT NULL,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    saldo INTEGER NOT NULL DEFAULT 0 CHECK (saldo >= 0),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (produto_id, local_id),
    CONSTRAINT estoque_locais_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
    CONSTRAINT estoque_locais_local_fk FOREIGN KEY (local_id, empresa_id) REFERENCES locais_estoque (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_estoque_locais_local ON estoque_locais (empresa_id, local_id);

ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS local_id INTEGER;
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS saldo_local_resultante INTEGER;

-- Central e Em trânsito para toda empresa existente.
INSERT INTO locais_estoque (empresa_id, tipo, nome)
SELECT e.id, 'central', 'Central' FROM empresas e
WHERE NOT EXISTS (SELECT 1 FROM locais_estoque l WHERE l.empresa_id = e.id AND l.tipo = 'central');

INSERT INTO locais_estoque (empresa_id, tipo, nome)
SELECT e.id, 'transito', 'Em trânsito' FROM empresas e
WHERE NOT EXISTS (SELECT 1 FROM locais_estoque l WHERE l.empresa_id = e.id AND l.tipo = 'transito');

-- Saldo atual de cada produto vai para o Central (só onde ainda não há linha de saldo).
INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo)
SELECT p.id, l.id, p.empresa_id, p.estoque_atual
FROM produtos p
JOIN locais_estoque l ON l.empresa_id = p.empresa_id AND l.tipo = 'central'
WHERE p.estoque_atual > 0
ON CONFLICT (produto_id, local_id) DO NOTHING;

-- Histórico existente: tudo aconteceu no Central; o saldo do local era o saldo total.
UPDATE movimentacoes_estoque m
SET local_id = l.id,
    saldo_local_resultante = COALESCE(m.saldo_local_resultante, m.estoque_resultante)
FROM locais_estoque l
WHERE m.local_id IS NULL AND l.empresa_id = m.empresa_id AND l.tipo = 'central';

ALTER TABLE movimentacoes_estoque ALTER COLUMN local_id SET NOT NULL;
ALTER TABLE movimentacoes_estoque ALTER COLUMN saldo_local_resultante SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'movimentacoes_estoque_local_fk') THEN
        ALTER TABLE movimentacoes_estoque
            ADD CONSTRAINT movimentacoes_estoque_local_fk
            FOREIGN KEY (local_id, empresa_id) REFERENCES locais_estoque (id, empresa_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_local ON movimentacoes_estoque (empresa_id, local_id);

-- Reversão manual (não executada pelo runner):
--   ALTER TABLE movimentacoes_estoque DROP CONSTRAINT IF EXISTS movimentacoes_estoque_local_fk;
--   ALTER TABLE movimentacoes_estoque DROP COLUMN IF EXISTS saldo_local_resultante, DROP COLUMN IF EXISTS local_id;
--   DROP TABLE IF EXISTS estoque_locais; DROP TABLE IF EXISTS locais_estoque;
