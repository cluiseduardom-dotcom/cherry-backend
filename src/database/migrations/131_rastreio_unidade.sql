-- 131: rastreio por unidade (IMEI / número de série) — ADR-008, primeira entrega.
--
-- Produto marcado com `rastreia_unidade` passa a ter UMA linha por aparelho em `unidades_rastreadas`; o saldo do produto
-- continua em `produtos.estoque_atual` e fecha com a contagem de unidades `em_estoque` (a entrada, a venda e o cancelamento
-- mexem nos dois na mesma transação). Perfume, acessório e demais produtos seguem por quantidade (flag false, sem mudança).
-- Um identificador por unidade (IMEI de 15 dígitos com dígito verificador, ou número de série), único por empresa.
-- Sem alteração de dado existente: todo produto atual fica com `rastreia_unidade = false`. Idempotente.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS rastreia_unidade BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS unidades_rastreadas (
    id                 SERIAL PRIMARY KEY,
    empresa_id         INTEGER NOT NULL REFERENCES empresas(id),
    produto_id         INTEGER NOT NULL,
    identificador      VARCHAR(40) NOT NULL,
    tipo_identificador VARCHAR(5) NOT NULL CHECK (tipo_identificador IN ('imei', 'serie')),
    status             VARCHAR(15) NOT NULL DEFAULT 'em_estoque'
                           CHECK (status IN ('em_estoque', 'vendida', 'devolvida', 'baixada')),
    compra_id          INTEGER REFERENCES compras(id),
    item_venda_id      INTEGER REFERENCES itens_venda(id),
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_unidades_rastreadas_identificador UNIQUE (empresa_id, identificador),
    CONSTRAINT uq_unidades_rastreadas_id_empresa UNIQUE (id, empresa_id),
    CONSTRAINT unidades_rastreadas_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_unidades_rastreadas_produto_status ON unidades_rastreadas (empresa_id, produto_id, status);
CREATE INDEX IF NOT EXISTS idx_unidades_rastreadas_compra ON unidades_rastreadas (compra_id) WHERE compra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unidades_rastreadas_item_venda ON unidades_rastreadas (item_venda_id) WHERE item_venda_id IS NOT NULL;

-- Histórico por unidade (garantia e auditoria): nada é apagado.
CREATE TABLE IF NOT EXISTS unidades_rastreadas_eventos (
    id          SERIAL PRIMARY KEY,
    empresa_id  INTEGER NOT NULL REFERENCES empresas(id),
    unidade_id  INTEGER NOT NULL,
    evento      VARCHAR(25) NOT NULL
                    CHECK (evento IN ('entrada', 'venda', 'cancelamento_venda', 'baixa', 'cancelamento_compra')),
    referencia  VARCHAR(60),
    motivo      TEXT,
    usuario_id  INTEGER,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unidades_rastreadas_eventos_unidade_fk FOREIGN KEY (unidade_id, empresa_id) REFERENCES unidades_rastreadas (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_unidades_rastreadas_eventos_unidade ON unidades_rastreadas_eventos (empresa_id, unidade_id, id);

-- Reversão manual (não executada pelo runner; só se nenhuma unidade tiver sido registrada):
--   DROP TABLE unidades_rastreadas_eventos;
--   DROP TABLE unidades_rastreadas;
--   ALTER TABLE produtos DROP COLUMN rastreia_unidade;
