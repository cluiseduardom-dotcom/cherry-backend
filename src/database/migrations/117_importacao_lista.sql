-- Importação de lista (produtos com custo e saldo inicial, clientes): prévia sem gravar + trilha de auditoria.
--
-- * Funcionalidade `importacao_lista` (módulo) no catálogo (089). Nasce SEM plano: a GiroNex liga avulsa, por empresa,
--   no Painel (incluir em plano é decisão comercial à parte, um INSERT em plano_funcionalidades).
-- * empresas.estoque_inicial_lancado_em: trava por empresa do saldo inicial em massa. Só a confirmação (PR seguinte) a grava;
--   a prévia já a lê para recusar a coluna de saldo. Anulável: empresa que nunca importou saldo fica NULL. A liberação de uma
--   segunda importação de saldo é feita pela GiroNex (volta a NULL), nunca por rota de empresa.
-- * importacoes: trilha de auditoria SEM dados pessoais (quem, tipo, arquivo, hash SHA-256, totais, status).
-- * importacoes_previas: a prévia pendente (linhas normalizadas a criar), ligada a um token de uso único que expira em 30 min.
--   Só o hash do token é guardado. O conteúdo é descartado na confirmação ou na expiração (LGPD); a linha de `importacoes` fica.
-- * O arquivo enviado nunca é guardado. Tudo com empresa_id e FK composta (usuário e local da mesma empresa).
-- * Só acrescenta. Idempotente. Reversão manual no rodapé.

INSERT INTO funcionalidades (codigo, nome, tipo, vendavel) VALUES
    ('importacao_lista', 'Importação de lista: produtos, estoque inicial e clientes', 'modulo', true)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estoque_inicial_lancado_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS importacoes (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    usuario_id INTEGER NOT NULL,
    tipo VARCHAR(10) NOT NULL,
    nome_arquivo VARCHAR(255) NOT NULL,
    hash_sha256 CHAR(64) NOT NULL,
    local_padrao_id INTEGER,
    total_linhas INTEGER NOT NULL DEFAULT 0,
    total_a_criar INTEGER NOT NULL DEFAULT 0,
    total_ignoradas INTEGER NOT NULL DEFAULT 0,
    total_com_aviso INTEGER NOT NULL DEFAULT 0,
    total_com_erro INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'previa',
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmada_em TIMESTAMPTZ,
    CONSTRAINT importacoes_tipo_chk CHECK (tipo IN ('produtos', 'clientes')),
    CONSTRAINT importacoes_status_chk CHECK (status IN ('previa', 'confirmada', 'expirada')),
    CONSTRAINT importacoes_hash_chk CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT importacoes_totais_chk CHECK (
        total_linhas >= 0 AND total_a_criar >= 0 AND total_ignoradas >= 0 AND total_com_aviso >= 0 AND total_com_erro >= 0
    ),
    CONSTRAINT importacoes_usuario_fk FOREIGN KEY (usuario_id, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT importacoes_local_fk FOREIGN KEY (local_padrao_id, empresa_id) REFERENCES locais_estoque (id, empresa_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_importacoes_id_empresa ON importacoes (id, empresa_id);
CREATE INDEX IF NOT EXISTS idx_importacoes_empresa ON importacoes (empresa_id, criada_em DESC);

CREATE TABLE IF NOT EXISTS importacoes_previas (
    importacao_id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    token_hash CHAR(64) NOT NULL,
    dados JSONB NOT NULL,
    expira_em TIMESTAMPTZ NOT NULL,
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT importacoes_previas_token_uk UNIQUE (token_hash),
    CONSTRAINT importacoes_previas_importacao_fk FOREIGN KEY (importacao_id, empresa_id)
        REFERENCES importacoes (id, empresa_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_importacoes_previas_expira ON importacoes_previas (empresa_id, expira_em);

-- Reversão manual (não executada pelo runner):
--   DROP TABLE IF EXISTS importacoes_previas;
--   DROP TABLE IF EXISTS importacoes;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS estoque_inicial_lancado_em;
--   DELETE FROM empresa_funcionalidades WHERE funcionalidade = 'importacao_lista';
--   DELETE FROM plano_funcionalidades WHERE funcionalidade = 'importacao_lista';
--   DELETE FROM funcionalidades WHERE codigo = 'importacao_lista';
