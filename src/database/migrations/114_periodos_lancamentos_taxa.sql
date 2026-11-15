-- Taxas a receber (Painel GiroNex), etapa 1: períodos de cobrança e lançamentos da taxa da plataforma.
-- SPEC: docs/SPEC_Taxas_a_Receber_Painel_GiroNex.md (seções 4, 5 e 7).
--
-- * periodos_taxa: uma competência (mês civil de Brasília) por empresa. Nasce 'aberto' (totais ainda vivos,
--   calculados de taxas_venda); no fechamento os totais são CONGELADOS. Fechado é imutável (T2): só o status
--   avança (fechado -> parcialmente_pago -> pago). Nunca é apagado.
-- * lancamentos_taxa: livro só-inserção (UPDATE/DELETE recusados pelo banco). Valor COM SINAL, no efeito
--   sobre o saldo devido pela empresa:
--       saldo do período = total_calculado - total_retido_mp + SUM(lancamentos.valor)
--   pagamento, perdão e estorno de venda são negativos; ajuste é positivo ou negativo (nunca zero).
--   Pagamento e perdão só em período já fechado; ajuste e estorno de venda só em período aberto
--   (correção de período fechado = ajuste no período seguinte, T2/T3). Pagamento/perdão que deixaria o
--   saldo negativo é recusado (T4), com o período travado (FOR UPDATE) contra concorrência.
--
-- Dado interno da GiroNex (R4/R6): nenhuma rota de tenant lê estas tabelas; a taxa nunca aparece em
-- vendas, PDV, recibo ou documento fiscal. empresa_id em ambas e referências compostas (id, empresa_id):
-- o banco recusa lançamento ligado a período ou venda de outra empresa.
--
-- Aditiva e idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS periodos_taxa (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas (id),
    -- Primeiro dia do mês de competência (YYYY-MM-01), mês civil de Brasília.
    competencia DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'aberto',
    -- Congelados no fechamento; nulos enquanto aberto.
    total_calculado NUMERIC(15,2),
    total_retido_mp NUMERIC(15,2),
    vencimento DATE,
    fechado_em TIMESTAMP,
    fechado_por VARCHAR(255),
    fechado_por_operador_id INTEGER REFERENCES plataforma_operadores (id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_periodos_taxa_empresa_competencia UNIQUE (empresa_id, competencia),
    CONSTRAINT uq_periodos_taxa_id_empresa UNIQUE (id, empresa_id),
    CONSTRAINT ck_periodos_taxa_competencia_dia_1 CHECK (EXTRACT(DAY FROM competencia) = 1),
    CONSTRAINT ck_periodos_taxa_status CHECK (status IN ('aberto', 'fechado', 'parcialmente_pago', 'pago')),
    CONSTRAINT ck_periodos_taxa_totais_nao_negativos CHECK (
        (total_calculado IS NULL OR total_calculado >= 0) AND (total_retido_mp IS NULL OR total_retido_mp >= 0)
    ),
    -- Aberto: nada congelado. Fora de aberto: totais, vencimento e autoria do fechamento obrigatórios.
    CONSTRAINT ck_periodos_taxa_fechamento CHECK (
        (status = 'aberto'
            AND total_calculado IS NULL AND total_retido_mp IS NULL AND vencimento IS NULL
            AND fechado_em IS NULL AND fechado_por IS NULL AND fechado_por_operador_id IS NULL)
        OR
        (status <> 'aberto'
            AND total_calculado IS NOT NULL AND total_retido_mp IS NOT NULL AND vencimento IS NOT NULL
            AND fechado_em IS NOT NULL AND fechado_por IS NOT NULL AND btrim(fechado_por) <> ''
            AND vencimento > competencia)
    )
);

CREATE INDEX IF NOT EXISTS idx_periodos_taxa_status_vencimento ON periodos_taxa (status, vencimento);
CREATE INDEX IF NOT EXISTS idx_periodos_taxa_competencia ON periodos_taxa (competencia);

-- Período: sem DELETE; empresa/competência nunca mudam; fechado nunca reabre nem muda os valores
-- congelados; status só avança. Bypass só na limpeza dos testes de integração (mesmo padrão da 085).
CREATE OR REPLACE FUNCTION periodos_taxa_protegido() RETURNS trigger AS $$
DECLARE
    ordem_antiga INTEGER;
    ordem_nova INTEGER;
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'periodos_taxa não pode ser apagado' USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.competencia IS DISTINCT FROM OLD.competencia
       OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
        RAISE EXCEPTION 'empresa e competência do período são imutáveis' USING ERRCODE = 'restrict_violation';
    END IF;

    ordem_antiga := array_position(ARRAY['aberto', 'fechado', 'parcialmente_pago', 'pago'], OLD.status::text);
    ordem_nova := array_position(ARRAY['aberto', 'fechado', 'parcialmente_pago', 'pago'], NEW.status::text);

    IF OLD.status = 'aberto' THEN
        IF NEW.status NOT IN ('aberto', 'fechado') THEN
            RAISE EXCEPTION 'período aberto só pode ser fechado (% recusado)', NEW.status
                USING ERRCODE = 'restrict_violation';
        END IF;
    ELSE
        IF NEW.total_calculado IS DISTINCT FROM OLD.total_calculado
           OR NEW.total_retido_mp IS DISTINCT FROM OLD.total_retido_mp
           OR NEW.vencimento IS DISTINCT FROM OLD.vencimento
           OR NEW.fechado_em IS DISTINCT FROM OLD.fechado_em
           OR NEW.fechado_por IS DISTINCT FROM OLD.fechado_por
           OR NEW.fechado_por_operador_id IS DISTINCT FROM OLD.fechado_por_operador_id THEN
            RAISE EXCEPTION 'período fechado é imutável: correção é ajuste no período seguinte'
                USING ERRCODE = 'restrict_violation';
        END IF;

        IF ordem_nova < ordem_antiga THEN
            RAISE EXCEPTION 'status do período não volta (% -> %)', OLD.status, NEW.status
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;

    NEW.atualizado_em := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_periodos_taxa_protegido ON periodos_taxa;
CREATE TRIGGER trg_periodos_taxa_protegido
    BEFORE UPDATE OR DELETE ON periodos_taxa
    FOR EACH ROW EXECUTE FUNCTION periodos_taxa_protegido();

CREATE TABLE IF NOT EXISTS lancamentos_taxa (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas (id),
    periodo_id INTEGER NOT NULL,
    tipo VARCHAR(20) NOT NULL,
    -- Efeito no saldo devido pela empresa (negativo reduz).
    valor NUMERIC(15,2) NOT NULL,
    venda_id INTEGER,
    -- Pagamento (T4): data, forma (lista fechada) e comprovante opcional. O comprovante fica no
    -- armazenamento de objetos (S3), como as demais imagens/arquivos: aqui só a chave do objeto.
    data_pagamento DATE,
    forma_pagamento VARCHAR(20),
    comprovante_chave VARCHAR(300),
    justificativa TEXT,
    -- Responsável gravado pelo backend (usuário logado), nunca pelo corpo da requisição.
    responsavel VARCHAR(255) NOT NULL,
    operador_id INTEGER REFERENCES plataforma_operadores (id),
    -- Retry do mesmo lançamento (duplo clique, reenvio) não duplica.
    chave_idempotencia VARCHAR(80),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_lancamentos_taxa_periodo FOREIGN KEY (periodo_id, empresa_id)
        REFERENCES periodos_taxa (id, empresa_id),
    CONSTRAINT fk_lancamentos_taxa_venda FOREIGN KEY (venda_id, empresa_id)
        REFERENCES vendas (id, empresa_id),
    CONSTRAINT ck_lancamentos_taxa_tipo CHECK (tipo IN ('pagamento', 'ajuste', 'perdao', 'estorno_venda')),
    CONSTRAINT ck_lancamentos_taxa_responsavel CHECK (btrim(responsavel) <> ''),
    CONSTRAINT ck_lancamentos_taxa_sinal CHECK (
        (tipo IN ('pagamento', 'perdao', 'estorno_venda') AND valor < 0)
        OR (tipo = 'ajuste' AND valor <> 0)
    ),
    CONSTRAINT ck_lancamentos_taxa_pagamento CHECK (
        (tipo = 'pagamento'
            AND data_pagamento IS NOT NULL AND forma_pagamento IS NOT NULL AND venda_id IS NULL)
        OR (tipo <> 'pagamento' AND data_pagamento IS NULL AND forma_pagamento IS NULL AND comprovante_chave IS NULL)
    ),
    CONSTRAINT ck_lancamentos_taxa_forma_pagamento CHECK (
        forma_pagamento IS NULL OR forma_pagamento IN ('pix', 'transferencia', 'boleto')
    ),
    -- Perdão e ajuste exigem justificativa (T5); estorno de venda exige a venda (T3).
    CONSTRAINT ck_lancamentos_taxa_justificativa CHECK (
        tipo NOT IN ('perdao', 'ajuste') OR (justificativa IS NOT NULL AND length(btrim(justificativa)) >= 5)
    ),
    CONSTRAINT ck_lancamentos_taxa_venda CHECK (
        (tipo = 'estorno_venda' AND venda_id IS NOT NULL)
        OR (tipo IN ('pagamento', 'perdao') AND venda_id IS NULL)
        OR tipo = 'ajuste'
    )
);

CREATE INDEX IF NOT EXISTS idx_lancamentos_taxa_periodo ON lancamentos_taxa (periodo_id, id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_taxa_empresa ON lancamentos_taxa (empresa_id, criado_em DESC);
-- Uma venda só é estornada uma vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lancamentos_taxa_estorno_venda
    ON lancamentos_taxa (empresa_id, venda_id) WHERE tipo = 'estorno_venda';
CREATE UNIQUE INDEX IF NOT EXISTS uq_lancamentos_taxa_idempotencia
    ON lancamentos_taxa (empresa_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;

-- Livro só-inserção.
CREATE OR REPLACE FUNCTION lancamentos_taxa_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'lancamentos_taxa é só-inserção (% recusado)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lancamentos_taxa_imutavel ON lancamentos_taxa;
CREATE TRIGGER trg_lancamentos_taxa_imutavel
    BEFORE UPDATE OR DELETE ON lancamentos_taxa
    FOR EACH ROW EXECUTE FUNCTION lancamentos_taxa_imutavel();

-- Regras de inserção que dependem do período: tipo x status (T2/T3) e saldo nunca negativo por
-- pagamento ou perdão (T4). O período é travado (FOR UPDATE) para serializar lançamentos concorrentes.
CREATE OR REPLACE FUNCTION lancamentos_taxa_validar_insercao() RETURNS trigger AS $$
DECLARE
    periodo periodos_taxa%ROWTYPE;
    saldo NUMERIC(15,2);
BEGIN
    SELECT * INTO periodo FROM periodos_taxa
     WHERE id = NEW.periodo_id AND empresa_id = NEW.empresa_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'período % não encontrado para a empresa %', NEW.periodo_id, NEW.empresa_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.tipo IN ('ajuste', 'estorno_venda') AND periodo.status <> 'aberto' THEN
        RAISE EXCEPTION '% só em período aberto: período fechado é imutável (lançar no período seguinte)', NEW.tipo
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.tipo IN ('pagamento', 'perdao') THEN
        IF periodo.status = 'aberto' THEN
            RAISE EXCEPTION '% só em período fechado', NEW.tipo USING ERRCODE = 'check_violation';
        END IF;

        SELECT periodo.total_calculado - periodo.total_retido_mp + COALESCE(SUM(l.valor), 0)
          INTO saldo
          FROM lancamentos_taxa l
         WHERE l.periodo_id = NEW.periodo_id;

        IF saldo + NEW.valor < 0 THEN
            RAISE EXCEPTION '% de % maior que o saldo do período (%)', NEW.tipo, -NEW.valor, saldo
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lancamentos_taxa_validar_insercao ON lancamentos_taxa;
CREATE TRIGGER trg_lancamentos_taxa_validar_insercao
    BEFORE INSERT ON lancamentos_taxa
    FOR EACH ROW EXECUTE FUNCTION lancamentos_taxa_validar_insercao();

-- Reversão manual (não executada pelo runner; só antes de existir lançamento real):
--   DROP TABLE IF EXISTS lancamentos_taxa;
--   DROP TABLE IF EXISTS periodos_taxa;
--   DROP FUNCTION IF EXISTS lancamentos_taxa_validar_insercao();
--   DROP FUNCTION IF EXISTS lancamentos_taxa_imutavel();
--   DROP FUNCTION IF EXISTS periodos_taxa_protegido();
