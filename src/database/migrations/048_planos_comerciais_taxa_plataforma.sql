-- Taxa interna da plataforma (VERTUMNO/GiroOne): modelo comercial configurável.
--
-- Evolui as migrations 046/047 SEM editá-las:
--   * planos_comerciais: sem_mensalidade (0,15%) e com_mensalidade (0,10%);
--   * politicas_taxa_plataforma passa a ser versionada POR PLANO (continua
--     global, sem empresa_id);
--   * empresa_planos: plano de cada empresa, com vigência e trilha de auditoria;
--   * condicoes_comerciais_empresa: exceção individual negociada (inclusive 0%),
--     com justificativa, responsável e vigência;
--   * taxas_venda congela também o plano, a condição e a origem da regra usada.
--
-- Prioridade na hora da venda (vendasRepository.criar -> taxasPlataformaRepository):
--   1. condição individual vigente da empresa  -> origem 'excecao_empresa'
--   2. política vigente do plano vigente da empresa -> origem 'plano_padrao'
--   3. empresa sem plano vigente: plano sem_mensalidade -> 'padrao_sem_plano'
--   Condição expirada ou futura é ignorada (volta ao padrão do plano). Política
--   do plano ausente/inválida continua bloqueando a venda (rollback).
--
-- Mensalidade e taxa por venda são independentes: aqui só existe o percentual
-- por venda. A cobrança da mensalidade (billing) é outro escopo.
--
-- Não há papel Super Admin nem rota de tenant que escreva estas tabelas:
-- hoje a GiroOne as administra por migration/SQL. O histórico não é editado:
-- um gatilho impede alterar percentual, empresa, justificativa, responsável e
-- início da vigência; só vigencia_fim e ativo podem mudar (encerramento).
--
-- Exclusão de sobreposição sem extensão: int4range(x, x, '[]') && é igualdade.

-- ---------------------------------------------------------------------------
-- Planos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS planos_comerciais (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    nome VARCHAR(100) NOT NULL,
    tem_mensalidade BOOLEAN NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO planos_comerciais (codigo, nome, tem_mensalidade) VALUES
    ('sem_mensalidade', 'Plano sem mensalidade', false),
    ('com_mensalidade', 'Plano com mensalidade', true)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Políticas (046) passam a ser por plano. A política 0,15% existente vira a do
-- plano sem_mensalidade; a do plano com_mensalidade (0,10%) é semeada abaixo.
-- ---------------------------------------------------------------------------
ALTER TABLE politicas_taxa_plataforma
    ADD COLUMN IF NOT EXISTS plano_id INTEGER REFERENCES planos_comerciais(id);

UPDATE politicas_taxa_plataforma
SET plano_id = (SELECT id FROM planos_comerciais WHERE codigo = 'sem_mensalidade')
WHERE plano_id IS NULL;

ALTER TABLE politicas_taxa_plataforma ALTER COLUMN plano_id SET NOT NULL;

ALTER TABLE politicas_taxa_plataforma DROP CONSTRAINT IF EXISTS ex_politica_taxa_vigencia_ativa;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ex_politica_taxa_plano_vigencia_ativa') THEN
        ALTER TABLE politicas_taxa_plataforma
            ADD CONSTRAINT ex_politica_taxa_plano_vigencia_ativa
            EXCLUDE USING gist (
                int4range(plano_id, plano_id, '[]') WITH &&,
                daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
            ) WHERE (ativo);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_politicas_taxa_plano ON politicas_taxa_plataforma (plano_id);

INSERT INTO politicas_taxa_plataforma (tipo, percentual, vigencia_inicio, vigencia_fim, ativo, descricao, plano_id)
SELECT 'percentual', 0.1000, DATE '2026-10-09', NULL, true,
       'Política inicial do plano com mensalidade: 0,10% sobre o total da venda',
       p.id
FROM planos_comerciais p
WHERE p.codigo = 'com_mensalidade'
  AND NOT EXISTS (SELECT 1 FROM politicas_taxa_plataforma t WHERE t.plano_id = p.id);

-- ---------------------------------------------------------------------------
-- Plano de cada empresa (histórico com vigência)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empresa_planos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    plano_id INTEGER NOT NULL REFERENCES planos_comerciais(id),
    vigencia_inicio DATE NOT NULL,
    vigencia_fim DATE,
    ativo BOOLEAN NOT NULL DEFAULT true,
    justificativa TEXT NOT NULL,
    responsavel VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_empresa_plano_vigencia
        CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
    CONSTRAINT ck_empresa_plano_justificativa CHECK (btrim(justificativa) <> ''),
    CONSTRAINT ck_empresa_plano_responsavel CHECK (btrim(responsavel) <> ''),
    CONSTRAINT uq_empresa_plano_id_empresa UNIQUE (id, empresa_id),
    CONSTRAINT ex_empresa_plano_vigencia_ativa
        EXCLUDE USING gist (
            int4range(empresa_id, empresa_id, '[]') WITH &&,
            daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
        ) WHERE (ativo)
);

CREATE INDEX IF NOT EXISTS idx_empresa_planos_empresa ON empresa_planos (empresa_id, vigencia_inicio);

-- ---------------------------------------------------------------------------
-- Condição comercial individual (exceção negociada; percentual 0 é válido)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS condicoes_comerciais_empresa (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    tipo VARCHAR(20) NOT NULL DEFAULT 'percentual' CHECK (tipo IN ('percentual')),
    percentual NUMERIC(7,4) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
    vigencia_inicio DATE NOT NULL,
    vigencia_fim DATE,
    ativo BOOLEAN NOT NULL DEFAULT true,
    substitui_id INTEGER REFERENCES condicoes_comerciais_empresa(id),
    justificativa TEXT NOT NULL,
    responsavel VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT ck_condicao_vigencia
        CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
    CONSTRAINT ck_condicao_justificativa CHECK (btrim(justificativa) <> ''),
    CONSTRAINT ck_condicao_responsavel CHECK (btrim(responsavel) <> ''),
    CONSTRAINT uq_condicao_id_empresa UNIQUE (id, empresa_id),
    CONSTRAINT ex_condicao_empresa_vigencia_ativa
        EXCLUDE USING gist (
            int4range(empresa_id, empresa_id, '[]') WITH &&,
            daterange(vigencia_inicio, vigencia_fim, '[]') WITH &&
        ) WHERE (ativo)
);

CREATE INDEX IF NOT EXISTS idx_condicoes_empresa ON condicoes_comerciais_empresa (empresa_id, vigencia_inicio);

-- Trilha de auditoria: o que foi negociado/justificado/quem autorizou não muda.
CREATE OR REPLACE FUNCTION proteger_historico_empresa_planos() RETURNS trigger AS $$
BEGIN
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.plano_id IS DISTINCT FROM OLD.plano_id
       OR NEW.vigencia_inicio IS DISTINCT FROM OLD.vigencia_inicio
       OR NEW.justificativa IS DISTINCT FROM OLD.justificativa
       OR NEW.responsavel IS DISTINCT FROM OLD.responsavel
       OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
        RAISE EXCEPTION 'empresa_planos: histórico não pode ser editado; encerre a vigência e crie uma nova linha'
            USING ERRCODE = '23000';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION proteger_historico_condicoes_comerciais() RETURNS trigger AS $$
BEGIN
    IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
       OR NEW.tipo IS DISTINCT FROM OLD.tipo
       OR NEW.percentual IS DISTINCT FROM OLD.percentual
       OR NEW.vigencia_inicio IS DISTINCT FROM OLD.vigencia_inicio
       OR NEW.substitui_id IS DISTINCT FROM OLD.substitui_id
       OR NEW.justificativa IS DISTINCT FROM OLD.justificativa
       OR NEW.responsavel IS DISTINCT FROM OLD.responsavel
       OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
        RAISE EXCEPTION 'condicoes_comerciais_empresa: histórico não pode ser editado; encerre a vigência e crie uma nova linha'
            USING ERRCODE = '23000';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proteger_historico_empresa_planos ON empresa_planos;
CREATE TRIGGER trg_proteger_historico_empresa_planos
    BEFORE UPDATE ON empresa_planos
    FOR EACH ROW EXECUTE FUNCTION proteger_historico_empresa_planos();

DROP TRIGGER IF EXISTS trg_proteger_historico_condicoes ON condicoes_comerciais_empresa;
CREATE TRIGGER trg_proteger_historico_condicoes
    BEFORE UPDATE ON condicoes_comerciais_empresa
    FOR EACH ROW EXECUTE FUNCTION proteger_historico_condicoes_comerciais();

-- ---------------------------------------------------------------------------
-- taxas_venda (047): congela plano, condição e origem da regra aplicada.
-- Linhas anteriores a esta migration nasceram da política global de 0,15%,
-- antes de existirem planos: ficam como 'padrao_sem_plano'.
-- ---------------------------------------------------------------------------
ALTER TABLE taxas_venda
    ADD COLUMN IF NOT EXISTS plano_id INTEGER REFERENCES planos_comerciais(id),
    ADD COLUMN IF NOT EXISTS empresa_plano_id INTEGER,
    ADD COLUMN IF NOT EXISTS condicao_id INTEGER,
    ADD COLUMN IF NOT EXISTS origem VARCHAR(20);

UPDATE taxas_venda
SET plano_id = (SELECT id FROM planos_comerciais WHERE codigo = 'sem_mensalidade'),
    origem = 'padrao_sem_plano'
WHERE origem IS NULL;

ALTER TABLE taxas_venda ALTER COLUMN plano_id SET NOT NULL;
ALTER TABLE taxas_venda ALTER COLUMN origem SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_taxa_venda_origem') THEN
        ALTER TABLE taxas_venda ADD CONSTRAINT ck_taxa_venda_origem
            CHECK (origem IN ('excecao_empresa', 'plano_padrao', 'padrao_sem_plano'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_taxa_venda_origem_condicao') THEN
        ALTER TABLE taxas_venda ADD CONSTRAINT ck_taxa_venda_origem_condicao
            CHECK ((origem = 'excecao_empresa') = (condicao_id IS NOT NULL));
    END IF;

    -- FK composta: a condição/plano da empresa citada pertence ao MESMO tenant.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_taxa_venda_condicao_empresa') THEN
        ALTER TABLE taxas_venda ADD CONSTRAINT fk_taxa_venda_condicao_empresa
            FOREIGN KEY (condicao_id, empresa_id)
            REFERENCES condicoes_comerciais_empresa (id, empresa_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_taxa_venda_empresa_plano') THEN
        ALTER TABLE taxas_venda ADD CONSTRAINT fk_taxa_venda_empresa_plano
            FOREIGN KEY (empresa_plano_id, empresa_id)
            REFERENCES empresa_planos (id, empresa_id);
    END IF;
END $$;
