-- Loja online — fatia 2: reserva de estoque e pedidos de origem e-commerce.
--
-- RESERVA. O Vertumno não tinha reserva. Aqui ela é um LOCAL de estoque novo, `reserva` ("Reserva online"):
-- ao criar o pedido, a mercadoria sai do Central e vai para a Reserva (duas movimentações comuns no livro,
-- o total `produtos.estoque_atual` não muda); se o pedido expira ou é cancelado, volta ao Central. Como o PDV só
-- vende do Central e da própria maleta, a peça reservada não pode ser vendida em duas frentes, sem mudar o PDV.
--
-- ÚNICA ALTERAÇÃO EM ESTRUTURA EXISTENTE: as duas constraints de `locais_estoque` (tipo e dono) são recriadas
-- aceitando o tipo novo. É um relaxamento: toda linha que valia continua valendo. O resto só acrescenta.
-- O código é `reserva` (7 letras) porque a coluna `tipo` é VARCHAR(12); a coluna não é alterada.
--
-- PEDIDOS. `pedidos_loja` guarda o pedido do visitante com preço CONGELADO (o preço do cliente nunca vale: o
-- servidor grava o preço vigente do canal `online`). `chave_idempotencia` + `hash_requisicao` impedem pedido
-- duplicado por retry. A trilha `pedidos_loja_eventos` é só de inserção (o banco recusa UPDATE/DELETE).
-- Pagamento, venda e frete ligam depois (`venda_id`, `cobranca_codigo`, `frete` já existem, vazios).
-- Pedido nunca é apagado: expirado e cancelado ficam no histórico.
--
-- Reversão manual no rodapé (só é possível sem pedidos nem saldo na Reserva).

ALTER TABLE locais_estoque DROP CONSTRAINT IF EXISTS locais_estoque_tipo_chk;
ALTER TABLE locais_estoque
    ADD CONSTRAINT locais_estoque_tipo_chk CHECK (tipo IN ('central', 'maleta', 'consignado', 'transito', 'reserva'));

ALTER TABLE locais_estoque DROP CONSTRAINT IF EXISTS locais_estoque_dono_chk;
ALTER TABLE locais_estoque
    ADD CONSTRAINT locais_estoque_dono_chk CHECK (
        (tipo = 'maleta' AND usuario_id IS NOT NULL AND cliente_id IS NULL)
        OR (tipo = 'consignado' AND usuario_id IS NULL)
        OR (tipo IN ('central', 'transito', 'reserva') AND usuario_id IS NULL AND cliente_id IS NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS uq_locais_estoque_reserva ON locais_estoque (empresa_id) WHERE tipo = 'reserva';

CREATE TABLE IF NOT EXISTS pedidos_loja (
    id SERIAL PRIMARY KEY,
    -- Código público (UUID v4 gerado pelo backend): o que a cliente guarda para acompanhar o pedido.
    codigo UUID NOT NULL UNIQUE,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    status VARCHAR(24) NOT NULL DEFAULT 'aguardando_pagamento',
    cliente_nome VARCHAR(120) NOT NULL,
    cliente_email VARCHAR(160) NOT NULL,
    cliente_telefone VARCHAR(20),
    chave_idempotencia VARCHAR(80) NOT NULL,
    hash_requisicao CHAR(64) NOT NULL,
    subtotal NUMERIC(10, 2) NOT NULL,
    desconto NUMERIC(10, 2) NOT NULL DEFAULT 0,
    -- NULL = frete a combinar (decisão provisória do PO; troca por Melhor Envio antes do go-live).
    frete NUMERIC(10, 2),
    total NUMERIC(10, 2) NOT NULL,
    reserva_expira_em TIMESTAMPTZ NOT NULL,
    venda_id INTEGER REFERENCES vendas(id),
    cobranca_codigo UUID,
    pago_em TIMESTAMPTZ,
    encerrado_em TIMESTAMPTZ,
    motivo_encerramento VARCHAR(40),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pedidos_loja_status_chk CHECK (status IN ('aguardando_pagamento', 'pago', 'cancelado', 'expirado')),
    CONSTRAINT pedidos_loja_valores_chk CHECK (subtotal > 0 AND desconto >= 0 AND desconto <= subtotal AND (frete IS NULL OR frete >= 0)),
    CONSTRAINT pedidos_loja_total_chk CHECK (total = subtotal - desconto + COALESCE(frete, 0)),
    CONSTRAINT pedidos_loja_pago_chk CHECK (status <> 'pago' OR pago_em IS NOT NULL),
    CONSTRAINT pedidos_loja_encerrado_chk CHECK (status NOT IN ('cancelado', 'expirado') OR (encerrado_em IS NOT NULL AND motivo_encerramento IS NOT NULL)),
    CONSTRAINT pedidos_loja_idempotencia_uk UNIQUE (empresa_id, chave_idempotencia)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_loja_id_empresa ON pedidos_loja (id, empresa_id);
-- Varredura de reservas vencidas (só os pedidos ainda abertos).
CREATE INDEX IF NOT EXISTS idx_pedidos_loja_abertos ON pedidos_loja (reserva_expira_em) WHERE status = 'aguardando_pagamento';
-- Limite de pedidos abertos por e-mail.
CREATE INDEX IF NOT EXISTS idx_pedidos_loja_email_abertos ON pedidos_loja (empresa_id, LOWER(cliente_email)) WHERE status = 'aguardando_pagamento';

CREATE TABLE IF NOT EXISTS itens_pedido_loja (
    pedido_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    -- Nome e preço como estavam no momento do pedido (congelados).
    nome VARCHAR(255) NOT NULL,
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    preco_unitario NUMERIC(10, 2) NOT NULL CHECK (preco_unitario > 0),
    PRIMARY KEY (pedido_id, produto_id),
    CONSTRAINT itens_pedido_loja_pedido_fk FOREIGN KEY (pedido_id, empresa_id) REFERENCES pedidos_loja (id, empresa_id),
    CONSTRAINT itens_pedido_loja_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id)
);

CREATE TABLE IF NOT EXISTS pedidos_loja_eventos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    pedido_id INTEGER NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    status_anterior VARCHAR(24),
    status_novo VARCHAR(24) NOT NULL,
    detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pedidos_loja_eventos_pedido_fk FOREIGN KEY (pedido_id, empresa_id) REFERENCES pedidos_loja (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_pedidos_loja_eventos_pedido ON pedidos_loja_eventos (empresa_id, pedido_id, id);

CREATE OR REPLACE FUNCTION pedidos_loja_eventos_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'pedidos_loja_eventos é imutável (% recusado)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pedidos_loja_eventos_imutavel ON pedidos_loja_eventos;
CREATE TRIGGER trg_pedidos_loja_eventos_imutavel
    BEFORE UPDATE OR DELETE ON pedidos_loja_eventos
    FOR EACH ROW EXECUTE FUNCTION pedidos_loja_eventos_imutavel();

-- Reversão manual (não executada pelo runner; antes, devolva ao Central todo saldo da Reserva e não mantenha pedidos):
--   DROP TRIGGER IF EXISTS trg_pedidos_loja_eventos_imutavel ON pedidos_loja_eventos;
--   DROP FUNCTION IF EXISTS pedidos_loja_eventos_imutavel();
--   DROP TABLE IF EXISTS pedidos_loja_eventos; DROP TABLE IF EXISTS itens_pedido_loja; DROP TABLE IF EXISTS pedidos_loja;
--   DROP INDEX IF EXISTS uq_locais_estoque_reserva;
--   (movimentações e saldos já gravados no local 'reserva' precisam ser tratados antes de apagar o local)
--   ALTER TABLE locais_estoque DROP CONSTRAINT IF EXISTS locais_estoque_tipo_chk;
--   ALTER TABLE locais_estoque ADD CONSTRAINT locais_estoque_tipo_chk CHECK (tipo IN ('central', 'maleta', 'consignado', 'transito'));
--   ALTER TABLE locais_estoque DROP CONSTRAINT IF EXISTS locais_estoque_dono_chk;
--   ALTER TABLE locais_estoque ADD CONSTRAINT locais_estoque_dono_chk CHECK (
--       (tipo = 'maleta' AND usuario_id IS NOT NULL AND cliente_id IS NULL)
--       OR (tipo = 'consignado' AND usuario_id IS NULL)
--       OR (tipo IN ('central', 'transito') AND usuario_id IS NULL AND cliente_id IS NULL));
