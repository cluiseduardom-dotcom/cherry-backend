-- Cancelamento de venda com política por faixa de idade (SPEC "Cargos, permissões e
-- cancelamento de venda", PR 2).
--
-- cancelamentos_venda: registro IMUTÁVEL de cada cancelamento (um por venda). Guarda quem
-- cancelou, quem autorizou (quando a faixa exige), o motivo, o momento, a faixa aplicada, os
-- dias de idade da venda, a quantidade devolvida ao estoque e o valor estornado. Os logins
-- ficam copiados na linha (snapshot): o histórico continua legível mesmo se o e-mail mudar.
-- A aplicação só faz INSERT; um gatilho recusa UPDATE e DELETE.
--
-- Aditiva e idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS cancelamentos_venda (
    id                    SERIAL        PRIMARY KEY,
    empresa_id            INTEGER       NOT NULL REFERENCES empresas(id),
    venda_id              INTEGER       NOT NULL REFERENCES vendas(id),
    motivo                TEXT          NOT NULL,
    cancelado_por         INTEGER       NOT NULL REFERENCES usuarios(id),
    cancelado_por_login   VARCHAR(255)  NOT NULL,
    autorizado_por        INTEGER       REFERENCES usuarios(id),
    autorizado_por_login  VARCHAR(255),
    faixa_aplicada        VARCHAR(20)   NOT NULL,
    dias_da_venda         INTEGER       NOT NULL,
    quantidade_devolvida  INTEGER       NOT NULL,
    valor_devolvido       NUMERIC(12,2) NOT NULL,
    cancelado_em          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT cancelamentos_venda_faixa_chk CHECK (faixa_aplicada IN ('ate_7_dias', '8_a_30_dias', 'acima_30_dias')),
    CONSTRAINT cancelamentos_venda_motivo_chk CHECK (length(btrim(motivo)) > 0),
    CONSTRAINT cancelamentos_venda_valores_chk CHECK (quantidade_devolvida >= 0 AND valor_devolvido >= 0 AND dias_da_venda >= 0),
    CONSTRAINT cancelamentos_venda_autorizacao_chk CHECK (
        (faixa_aplicada = 'ate_7_dias' AND autorizado_por IS NULL AND autorizado_por_login IS NULL)
        OR (faixa_aplicada <> 'ate_7_dias' AND autorizado_por IS NOT NULL AND autorizado_por_login IS NOT NULL)
    ),
    CONSTRAINT uq_cancelamentos_venda_venda UNIQUE (empresa_id, venda_id)
);

CREATE INDEX IF NOT EXISTS idx_cancelamentos_venda_empresa_data
    ON cancelamentos_venda (empresa_id, cancelado_em DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_cancelamentos_venda_empresa_usuario
    ON cancelamentos_venda (empresa_id, cancelado_por);

-- Imutabilidade no banco. A única exceção é a limpeza das empresas descartáveis dos testes de
-- integração, que liga o parâmetro de sessão vertumno.limpeza_teste dentro da própria transação.
CREATE OR REPLACE FUNCTION cancelamentos_venda_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'cancelamentos_venda é imutável (% recusado)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cancelamentos_venda_imutavel ON cancelamentos_venda;
CREATE TRIGGER trg_cancelamentos_venda_imutavel
    BEFORE UPDATE OR DELETE ON cancelamentos_venda
    FOR EACH ROW EXECUTE FUNCTION cancelamentos_venda_imutavel();

-- Reversão manual (não executada pelo runner; só se nenhum cancelamento tiver sido registrado):
--   DROP TRIGGER IF EXISTS trg_cancelamentos_venda_imutavel ON cancelamentos_venda;
--   DROP FUNCTION IF EXISTS cancelamentos_venda_imutavel();
--   DROP TABLE IF EXISTS cancelamentos_venda;
