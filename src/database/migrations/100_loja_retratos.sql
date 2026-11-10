-- Loja online — retratos da abertura da Home, geridos pelo ERP (sem mexer em código nem no GitHub).
--
-- * loja_retratos: foto + texto alternativo + nome opcional + ordem. Nasce INATIVA e SEM autorização.
-- * Autorização de uso de imagem: o admin confirma que tem o termo ASSINADO em mãos; ficam registrados quem
--   confirmou e quando (autorizado_por, autorizado_em). Só entra na loja pública o retrato ativo E autorizado.
--   Revogar a autorização desativa o retrato na hora.
-- * Remover = removido_em (a linha fica como trilha da autorização; o arquivo sai do armazenamento).
-- * Só acrescenta: não altera nenhuma tabela, coluna ou contrato existente. Idempotente.
-- Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS loja_retratos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    chave VARCHAR(300) NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    tamanho_bytes INTEGER NOT NULL,
    alt VARCHAR(300),
    nome VARCHAR(120),
    ordem INTEGER NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT false,
    autorizacao_assinada BOOLEAN NOT NULL DEFAULT false,
    autorizado_por INTEGER,
    autorizado_em TIMESTAMPTZ,
    criado_por INTEGER,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removido_em TIMESTAMPTZ,
    CONSTRAINT loja_retratos_chave_uk UNIQUE (chave),
    CONSTRAINT loja_retratos_content_type_chk CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT loja_retratos_tamanho_chk CHECK (tamanho_bytes > 0),
    -- Só pode estar ativo quem tem autorização registrada e descrição.
    CONSTRAINT loja_retratos_ativo_chk CHECK (NOT ativo OR (autorizacao_assinada AND alt IS NOT NULL AND btrim(alt) <> '')),
    CONSTRAINT loja_retratos_autorizado_por_fk FOREIGN KEY (autorizado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT loja_retratos_criado_por_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id)
);

CREATE INDEX IF NOT EXISTS idx_loja_retratos_publicos ON loja_retratos (empresa_id, ordem, id) WHERE ativo AND autorizacao_assinada AND removido_em IS NULL;

-- Reversão manual (não executada pelo runner; antes, desligue o uso no código):
--   DROP TABLE IF EXISTS loja_retratos;
