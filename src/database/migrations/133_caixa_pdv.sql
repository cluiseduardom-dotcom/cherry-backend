-- 133: caixa por PDV (Tarefa 03, PR A: SOMENTE esquema). Nenhuma rota usa estas tabelas ainda e nenhuma venda muda.
--
-- Decisões do PO (26/11/2026): o caixa é OPCIONAL por empresa (funcionalidade `caixa`, ligada avulso pela GiroNex; a venda
-- continua sem caixa para quem não a tem); caixas NOMEADOS (Balcão 1, Balcão 2...) e qualquer operador autorizado abre um;
-- divergência no fechamento é registrada com justificativa e avisada, sem aprovação de gerente.
--
--  caixas             : o ponto de venda físico (nome único por empresa). Pode ser desativado; nunca apagado.
--  caixa_sessoes      : abertura (saldo inicial, operador) e fechamento. UMA sessão aberta por caixa (índice único parcial,
--                       sem corrida entre duas aberturas). Sessão fechada é imutável.
--  caixa_movimentos   : suprimento e sangria de dinheiro. Insere-só; só entra em sessão ABERTA (o banco recusa).
--  caixa_conferencias : no fechamento, por forma de pagamento: esperado x informado e a diferença. Insere-só.
-- Toda referência é composta (id, empresa_id): o banco recusa linha de outra empresa. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS caixas (
    id          SERIAL       PRIMARY KEY,
    empresa_id  INTEGER      NOT NULL REFERENCES empresas(id),
    nome        VARCHAR(60)  NOT NULL,
    ativo       BOOLEAN      NOT NULL DEFAULT true,
    criado_por  INTEGER      NOT NULL,
    criado_em   TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_caixas_id_empresa UNIQUE (id, empresa_id),
    CONSTRAINT caixas_criado_por_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT caixas_nome_chk CHECK (length(btrim(nome)) >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_caixas_empresa_nome ON caixas (empresa_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS caixa_sessoes (
    id                        SERIAL        PRIMARY KEY,
    empresa_id                INTEGER       NOT NULL REFERENCES empresas(id),
    caixa_id                  INTEGER       NOT NULL,
    operador_id               INTEGER       NOT NULL,
    status                    VARCHAR(10)   NOT NULL DEFAULT 'aberta',
    saldo_inicial             NUMERIC(15,2) NOT NULL DEFAULT 0,
    aberta_em                 TIMESTAMP     NOT NULL DEFAULT NOW(),
    fechada_em                TIMESTAMP,
    fechada_por               INTEGER,
    justificativa_divergencia TEXT,
    CONSTRAINT uq_caixa_sessoes_id_empresa UNIQUE (id, empresa_id),
    CONSTRAINT caixa_sessoes_caixa_fk FOREIGN KEY (caixa_id, empresa_id) REFERENCES caixas (id, empresa_id),
    CONSTRAINT caixa_sessoes_operador_fk FOREIGN KEY (operador_id, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT caixa_sessoes_fechada_por_fk FOREIGN KEY (fechada_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT caixa_sessoes_status_chk CHECK (status IN ('aberta', 'fechada')),
    CONSTRAINT caixa_sessoes_saldo_chk CHECK (saldo_inicial >= 0),
    CONSTRAINT caixa_sessoes_fechamento_chk CHECK (
        (status = 'aberta' AND fechada_em IS NULL AND fechada_por IS NULL)
        OR (status = 'fechada' AND fechada_em IS NOT NULL AND fechada_por IS NOT NULL)
    )
);

-- Uma única sessão aberta por caixa: duas aberturas simultâneas não passam das duas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_sessoes_uma_aberta ON caixa_sessoes (caixa_id) WHERE status = 'aberta';
CREATE INDEX IF NOT EXISTS idx_caixa_sessoes_empresa_data ON caixa_sessoes (empresa_id, aberta_em DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_caixa_sessoes_operador ON caixa_sessoes (empresa_id, operador_id, status);

CREATE TABLE IF NOT EXISTS caixa_movimentos (
    id          SERIAL        PRIMARY KEY,
    empresa_id  INTEGER       NOT NULL REFERENCES empresas(id),
    sessao_id   INTEGER       NOT NULL,
    tipo        VARCHAR(12)   NOT NULL,
    valor       NUMERIC(15,2) NOT NULL,
    motivo      TEXT          NOT NULL,
    usuario_id  INTEGER       NOT NULL,
    criado_em   TIMESTAMP     NOT NULL DEFAULT NOW(),
    CONSTRAINT caixa_movimentos_sessao_fk FOREIGN KEY (sessao_id, empresa_id) REFERENCES caixa_sessoes (id, empresa_id),
    CONSTRAINT caixa_movimentos_usuario_fk FOREIGN KEY (usuario_id, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT caixa_movimentos_tipo_chk CHECK (tipo IN ('suprimento', 'sangria')),
    CONSTRAINT caixa_movimentos_valor_chk CHECK (valor > 0),
    CONSTRAINT caixa_movimentos_motivo_chk CHECK (length(btrim(motivo)) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_caixa_movimentos_sessao ON caixa_movimentos (empresa_id, sessao_id, id);

CREATE TABLE IF NOT EXISTS caixa_conferencias (
    id          SERIAL        PRIMARY KEY,
    empresa_id  INTEGER       NOT NULL REFERENCES empresas(id),
    sessao_id   INTEGER       NOT NULL,
    forma       VARCHAR(20)   NOT NULL,
    esperado    NUMERIC(15,2) NOT NULL,
    informado   NUMERIC(15,2) NOT NULL,
    diferenca   NUMERIC(15,2) GENERATED ALWAYS AS (informado - esperado) STORED,
    criado_em   TIMESTAMP     NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_caixa_conferencias_sessao_forma UNIQUE (sessao_id, forma),
    CONSTRAINT caixa_conferencias_sessao_fk FOREIGN KEY (sessao_id, empresa_id) REFERENCES caixa_sessoes (id, empresa_id),
    CONSTRAINT caixa_conferencias_forma_chk CHECK (forma IN ('dinheiro', 'pix', 'debito', 'credito', 'crediario')),
    CONSTRAINT caixa_conferencias_informado_chk CHECK (informado >= 0)
);

-- Imutabilidade no banco (mesmo padrão de usuarios_eventos): a única exceção é a limpeza das empresas descartáveis dos
-- testes de integração, que liga vertumno.limpeza_teste dentro da própria transação.
CREATE OR REPLACE FUNCTION caixa_insere_so() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION '% é insere-só (% recusado)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_caixa_movimentos_insere_so ON caixa_movimentos;
CREATE TRIGGER trg_caixa_movimentos_insere_so
    BEFORE UPDATE OR DELETE ON caixa_movimentos
    FOR EACH ROW EXECUTE FUNCTION caixa_insere_so();

DROP TRIGGER IF EXISTS trg_caixa_conferencias_insere_so ON caixa_conferencias;
CREATE TRIGGER trg_caixa_conferencias_insere_so
    BEFORE UPDATE OR DELETE ON caixa_conferencias
    FOR EACH ROW EXECUTE FUNCTION caixa_insere_so();

-- Sessão: nunca apagada; aberta só muda para fechada (uma vez); fechada é imutável; a identidade da abertura não muda.
CREATE OR REPLACE FUNCTION caixa_sessoes_guarda() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'caixa_sessoes não pode ser apagada' USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status = 'fechada' THEN
        RAISE EXCEPTION 'sessão de caixa fechada é imutável' USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.caixa_id IS DISTINCT FROM OLD.caixa_id
       OR NEW.operador_id IS DISTINCT FROM OLD.operador_id
       OR NEW.saldo_inicial IS DISTINCT FROM OLD.saldo_inicial
       OR NEW.aberta_em IS DISTINCT FROM OLD.aberta_em THEN
        RAISE EXCEPTION 'a abertura da sessão de caixa não pode ser alterada' USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_caixa_sessoes_guarda ON caixa_sessoes;
CREATE TRIGGER trg_caixa_sessoes_guarda
    BEFORE UPDATE OR DELETE ON caixa_sessoes
    FOR EACH ROW EXECUTE FUNCTION caixa_sessoes_guarda();

-- Movimento e conferência só entram em sessão ABERTA. FOR SHARE trava a linha da sessão contra um fechamento concorrente:
-- ou o movimento entra antes do fechamento, ou o fechamento vence e o movimento é recusado.
CREATE OR REPLACE FUNCTION caixa_exige_sessao_aberta() RETURNS trigger AS $$
DECLARE
    situacao VARCHAR(10);
BEGIN
    SELECT status INTO situacao FROM caixa_sessoes WHERE id = NEW.sessao_id AND empresa_id = NEW.empresa_id FOR SHARE;

    IF situacao IS DISTINCT FROM 'aberta' THEN
        RAISE EXCEPTION 'a sessão de caixa não está aberta' USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_caixa_movimentos_sessao_aberta ON caixa_movimentos;
CREATE TRIGGER trg_caixa_movimentos_sessao_aberta
    BEFORE INSERT ON caixa_movimentos
    FOR EACH ROW EXECUTE FUNCTION caixa_exige_sessao_aberta();

DROP TRIGGER IF EXISTS trg_caixa_conferencias_sessao_aberta ON caixa_conferencias;
CREATE TRIGGER trg_caixa_conferencias_sessao_aberta
    BEFORE INSERT ON caixa_conferencias
    FOR EACH ROW EXECUTE FUNCTION caixa_exige_sessao_aberta();

-- Funcionalidade `caixa` (vendável; nenhum plano a inclui, a GiroNex liga avulso). Sem ela, o ERP segue sem caixa.
INSERT INTO funcionalidades (codigo, nome, tipo, vendavel) VALUES
    ('caixa', 'Caixa por PDV: abertura, sangria, suprimento e fechamento com conferência', 'modulo', true)
ON CONFLICT (codigo) DO NOTHING;

-- Reversão manual (não executada pelo runner; só vale se não há sessões a preservar):
--   DELETE FROM funcionalidades WHERE codigo = 'caixa';
--   DROP TABLE IF EXISTS caixa_conferencias, caixa_movimentos, caixa_sessoes, caixas;
--   DROP FUNCTION IF EXISTS caixa_exige_sessao_aberta(), caixa_sessoes_guarda(), caixa_insere_so();
