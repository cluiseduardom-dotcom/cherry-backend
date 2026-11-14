-- Fiado: controle de dívidas de clientes (compra a prazo sem produto), pagamentos parciais ou totais e saldo devedor.
--
-- * Funcionalidade `fiado` (módulo) no catálogo (089). Fica DESLIGADA para toda empresa: nenhum plano a inclui; a GiroNex liga
--   avulsa, por empresa.
-- * fiado_lancamentos: livro-razão APPEND-ONLY. Compra soma, pagamento subtrai, estorno inverte o lançamento estornado.
--   Nunca se edita nem se apaga (o banco recusa UPDATE/DELETE); correção é estorno, com motivo.
-- * fiado_saldos: saldo por cliente, atualizado na MESMA transação do lançamento, com a linha travada. CHECK (saldo >= 0):
--   o banco nunca aceita saldo negativo. O saldo é conferível pela soma dos lançamentos.
-- * Valores em NUMERIC(12,2). Datas de calendário em DATE. Tudo com empresa_id e FK composta (cliente/usuário da mesma empresa).
-- * Só acrescenta. Idempotente. Reversão manual no rodapé.

INSERT INTO funcionalidades (codigo, nome, tipo, vendavel) VALUES
    ('fiado', 'Fiado: dívidas de clientes e cobrança', 'modulo', true)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS fiado_saldos (
    empresa_id    INTEGER NOT NULL REFERENCES empresas(id),
    cliente_id    INTEGER NOT NULL,
    saldo         NUMERIC(12, 2) NOT NULL DEFAULT 0,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (empresa_id, cliente_id),
    CONSTRAINT fiado_saldos_nao_negativo_chk CHECK (saldo >= 0),
    CONSTRAINT fiado_saldos_cliente_fk FOREIGN KEY (cliente_id, empresa_id) REFERENCES clientes (id, empresa_id)
);

CREATE TABLE IF NOT EXISTS fiado_lancamentos (
    id                 BIGSERIAL PRIMARY KEY,
    empresa_id         INTEGER NOT NULL REFERENCES empresas(id),
    cliente_id         INTEGER NOT NULL,
    tipo               VARCHAR(10) NOT NULL,
    valor              NUMERIC(12, 2) NOT NULL,
    descricao          VARCHAR(200),
    data_lancamento    DATE NOT NULL,
    forma              VARCHAR(20),
    estorna_id         BIGINT REFERENCES fiado_lancamentos(id),
    motivo             VARCHAR(300),
    chave_idempotencia VARCHAR(80) NOT NULL,
    criado_por         INTEGER NOT NULL,
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fiado_lancamentos_tipo_chk CHECK (tipo IN ('compra', 'pagamento', 'estorno')),
    CONSTRAINT fiado_lancamentos_valor_chk CHECK (valor > 0),
    CONSTRAINT fiado_lancamentos_forma_chk CHECK (forma IS NULL OR forma IN ('dinheiro', 'pix', 'debito', 'credito', 'outro')),
    CONSTRAINT fiado_lancamentos_compra_chk CHECK (tipo <> 'compra' OR (descricao IS NOT NULL AND btrim(descricao) <> '' AND forma IS NULL AND estorna_id IS NULL)),
    CONSTRAINT fiado_lancamentos_pagamento_chk CHECK (tipo <> 'pagamento' OR estorna_id IS NULL),
    CONSTRAINT fiado_lancamentos_estorno_chk CHECK (tipo <> 'estorno' OR (estorna_id IS NOT NULL AND motivo IS NOT NULL AND btrim(motivo) <> '')),
    CONSTRAINT fiado_lancamentos_cliente_fk FOREIGN KEY (cliente_id, empresa_id) REFERENCES clientes (id, empresa_id),
    CONSTRAINT fiado_lancamentos_autor_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT fiado_lancamentos_chave_uk UNIQUE (empresa_id, chave_idempotencia)
);

-- Um lançamento só pode ser estornado uma vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiado_lancamentos_estorna ON fiado_lancamentos (estorna_id) WHERE estorna_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiado_lancamentos_cliente ON fiado_lancamentos (empresa_id, cliente_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_fiado_lancamentos_data ON fiado_lancamentos (empresa_id, data_lancamento);
CREATE INDEX IF NOT EXISTS idx_fiado_saldos_devedores ON fiado_saldos (empresa_id) WHERE saldo > 0;

CREATE OR REPLACE FUNCTION fiado_lancamentos_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'fiado_lancamentos é imutável (% recusado): corrija por estorno', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fiado_lancamentos_imutavel ON fiado_lancamentos;
CREATE TRIGGER trg_fiado_lancamentos_imutavel
    BEFORE UPDATE OR DELETE ON fiado_lancamentos
    FOR EACH ROW EXECUTE FUNCTION fiado_lancamentos_imutavel();

-- Reversão manual (não executada pelo runner; só depois de reverter o código que usa as tabelas e com autorização):
--   DROP TRIGGER IF EXISTS trg_fiado_lancamentos_imutavel ON fiado_lancamentos;
--   DROP FUNCTION IF EXISTS fiado_lancamentos_imutavel();
--   DROP TABLE IF EXISTS fiado_lancamentos;
--   DROP TABLE IF EXISTS fiado_saldos;
--   DELETE FROM empresa_funcionalidades WHERE funcionalidade = 'fiado';
--   DELETE FROM funcionalidades WHERE codigo = 'fiado';
