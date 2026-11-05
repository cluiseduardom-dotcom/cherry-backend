-- Funcionalidades por plano e por empresa (v2 do desenho de planos, PO 05/11/2026).
--
-- Uma lista única decide o que cada empresa vê: o que o PLANO inclui, mais o que a GiroNex LIGA avulso para a
-- empresa, menos o que a GiroNex DESLIGA explicitamente (desligar vence os dois). Ligação pode ter vigência.
-- O núcleo do ERP não é funcionalidade: está sempre ativo.
--
-- Esta migration só cria o catálogo, as inclusões por plano e a tabela de ligações. NENHUMA rota é bloqueada
-- ainda: o bloqueio entra nos PRs seguintes, rota a rota. Planos legados (sem_mensalidade, com_mensalidade) e
-- Padrão/Pro incluem os quatro recursos, então nenhuma empresa existente perde acesso por esta migration.
-- Básico e Cortesia não incluem nenhum (as ligações avulsas fazem o resto).
--
-- Catálogo fechado: só migration insere em `funcionalidades`; nenhuma rota de tenant escreve nestas tabelas.
-- A tabela empresa_modulos (053, vazia em produção e sem uso) fica como está; sai em migration própria depois.
-- Aditiva e idempotente. Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS funcionalidades (
    codigo VARCHAR(40) PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    tipo VARCHAR(10) NOT NULL,
    -- Módulo não construído fica falso: aparece como "em breve" e não liga.
    vendavel BOOLEAN NOT NULL DEFAULT false,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT funcionalidades_codigo_chk CHECK (codigo ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT funcionalidades_tipo_chk CHECK (tipo IN ('recurso', 'modulo'))
);

CREATE TABLE IF NOT EXISTS plano_funcionalidades (
    plano_id INTEGER NOT NULL REFERENCES planos_comerciais(id),
    funcionalidade VARCHAR(40) NOT NULL REFERENCES funcionalidades(codigo),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (plano_id, funcionalidade)
);

CREATE TABLE IF NOT EXISTS empresa_funcionalidades (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    funcionalidade VARCHAR(40) NOT NULL REFERENCES funcionalidades(codigo),
    -- true = liga avulso; false = desliga mesmo que o plano inclua.
    ligada BOOLEAN NOT NULL,
    justificativa TEXT NOT NULL,
    responsavel VARCHAR(120) NOT NULL,
    vigencia_inicio DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date),
    vigencia_fim DATE,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT empresa_funcionalidades_justificativa_chk CHECK (btrim(justificativa) <> ''),
    CONSTRAINT empresa_funcionalidades_responsavel_chk CHECK (btrim(responsavel) <> ''),
    CONSTRAINT empresa_funcionalidades_vigencia_chk CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
    CONSTRAINT empresa_funcionalidades_empresa_func_uk UNIQUE (empresa_id, funcionalidade)
);

CREATE INDEX IF NOT EXISTS idx_empresa_funcionalidades_empresa ON empresa_funcionalidades (empresa_id);

-- Catálogo inicial (espelha src/constants/funcionalidades.js; o teste de migration confere).
INSERT INTO funcionalidades (codigo, nome, tipo, vendavel) VALUES
    ('comissoes', 'Comissões', 'recurso', true),
    ('maletas', 'Maletas e múltiplos locais', 'recurso', true),
    ('bancos', 'Bancos e conciliação', 'recurso', true),
    ('analise_financeira', 'Análise financeira: ponto de equilíbrio e despesas fixas', 'recurso', true),
    ('fiscal', 'Fiscal', 'modulo', false),
    ('pcp', 'PCP: ordem de produção, ordem de serviço e consumo', 'modulo', false),
    ('grade', 'Grade de produtos', 'modulo', false),
    ('fracionario', 'Venda fracionada', 'modulo', false),
    ('rastreio_unidade', 'Rastreio por unidade', 'modulo', false),
    ('multi_pdv', 'Vários PDVs', 'modulo', false),
    ('servicos_agenda', 'Serviços e agenda', 'modulo', false)
ON CONFLICT (codigo) DO NOTHING;

-- Planos que incluem os quatro recursos: legados, Padrão e Pro. Plano que não existe é simplesmente pulado.
INSERT INTO plano_funcionalidades (plano_id, funcionalidade)
SELECT p.id, f.codigo
FROM planos_comerciais p
CROSS JOIN funcionalidades f
WHERE p.codigo IN ('sem_mensalidade', 'com_mensalidade', 'padrao', 'pro')
  AND f.tipo = 'recurso'
ON CONFLICT (plano_id, funcionalidade) DO NOTHING;

-- Reversão manual (não executada pelo runner):
--   DROP TABLE IF EXISTS empresa_funcionalidades;
--   DROP TABLE IF EXISTS plano_funcionalidades;
--   DROP TABLE IF EXISTS funcionalidades;
