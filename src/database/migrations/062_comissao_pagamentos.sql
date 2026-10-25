-- Pagamento de comissão ao vendedor (a empresa pagando o vendedor), registrado no sistema.
--
-- Até aqui a comissão era apurada e liberada, mas nada registrava que ela foi PAGA. Esta migration
-- adiciona o registro, sem alterar comissoes_venda nem os repasses (que são o vendedor repassando
-- dinheiro DA VENDA à empresa — outro sentido).
--
-- comissao_pagamentos: um pagamento (Pix, transferência, dinheiro, outro) a UM vendedor, feito por
--   um admin (nunca o próprio vendedor), com data, forma e observação.
-- comissao_pagamento_itens: quanto do pagamento cobre cada comissão. valor > 0 = comissão paga;
--   valor < 0 = DESCONTO de comissão já paga e depois estornada (venda cancelada, pagamento
--   estornado). A soma dos itens é igual ao valor do pagamento (a aplicação garante, na mesma transação).
--
-- A pagar de uma comissão = valor_liberado - SUM(itens). Positivo = falta pagar; negativo = pagou a
-- mais por causa de estorno posterior e será descontado no próximo pagamento.
--
-- As duas tabelas são imutáveis (gatilho recusa UPDATE/DELETE, exceto na limpeza de empresas de
-- teste) e têm FKs compostas com empresa_id, como as demais tabelas de comissão.
-- Migration só aditiva (CREATE ... IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS comissao_pagamentos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    vendedor_id INTEGER NOT NULL,
    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
    forma VARCHAR(20) NOT NULL CHECK (forma IN ('pix', 'transferencia', 'dinheiro', 'outro')),
    pago_em DATE NOT NULL,
    observacao TEXT,
    criado_por INTEGER NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_comissao_pagamento_nao_se_autopaga CHECK (criado_por <> vendedor_id),
    CONSTRAINT comissao_pagamentos_vendedor_empresa_fk FOREIGN KEY (vendedor_id, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT comissao_pagamentos_criador_empresa_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_comissao_pagamentos_id_empresa ON comissao_pagamentos (id, empresa_id);

CREATE INDEX IF NOT EXISTS idx_comissao_pagamentos_vendedor
    ON comissao_pagamentos (empresa_id, vendedor_id, id DESC);

CREATE TABLE IF NOT EXISTS comissao_pagamento_itens (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    pagamento_id INTEGER NOT NULL,
    comissao_id INTEGER NOT NULL,
    valor NUMERIC(15,2) NOT NULL CHECK (valor <> 0),
    CONSTRAINT uq_comissao_pagamento_item UNIQUE (pagamento_id, comissao_id),
    CONSTRAINT comissao_pagamento_itens_pagamento_empresa_fk FOREIGN KEY (pagamento_id, empresa_id) REFERENCES comissao_pagamentos (id, empresa_id),
    CONSTRAINT comissao_pagamento_itens_comissao_empresa_fk FOREIGN KEY (comissao_id, empresa_id) REFERENCES comissoes_venda (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_comissao_pagamento_itens_comissao
    ON comissao_pagamento_itens (empresa_id, comissao_id);

CREATE OR REPLACE FUNCTION comissao_pagamentos_imutavel() RETURNS trigger AS $$
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

DROP TRIGGER IF EXISTS trg_comissao_pagamentos_imutavel ON comissao_pagamentos;
CREATE TRIGGER trg_comissao_pagamentos_imutavel
    BEFORE UPDATE OR DELETE ON comissao_pagamentos
    FOR EACH ROW EXECUTE FUNCTION comissao_pagamentos_imutavel();

DROP TRIGGER IF EXISTS trg_comissao_pagamento_itens_imutavel ON comissao_pagamento_itens;
CREATE TRIGGER trg_comissao_pagamento_itens_imutavel
    BEFORE UPDATE OR DELETE ON comissao_pagamento_itens
    FOR EACH ROW EXECUTE FUNCTION comissao_pagamentos_imutavel();

-- Reversão manual (não executada pelo runner; só se nenhum pagamento tiver sido registrado):
--   DROP TABLE IF EXISTS comissao_pagamento_itens;
--   DROP TABLE IF EXISTS comissao_pagamentos;
--   DROP FUNCTION IF EXISTS comissao_pagamentos_imutavel();
