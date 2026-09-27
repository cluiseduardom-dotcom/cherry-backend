CREATE TABLE IF NOT EXISTS produtos_codigos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    codigo VARCHAR(100) NOT NULL,
    tipo VARCHAR(20) NOT NULL DEFAULT 'EAN_13',
    principal BOOLEAN NOT NULL DEFAULT false,
    descricao VARCHAR(255),
    ativo BOOLEAN NOT NULL DEFAULT true,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT produtos_codigos_tipo_chk CHECK (
        tipo IN ('EAN_8','EAN_13','EAN_14','UPC_A','GTIN_14','INTERNO','OUTRO')
    ),
    CONSTRAINT produtos_codigos_codigo_chk CHECK (length(trim(codigo)) > 0),
    CONSTRAINT produtos_codigos_empresa_produto_uk UNIQUE (empresa_id, produto_id, codigo),
    CONSTRAINT produtos_codigos_empresa_codigo_uk UNIQUE (empresa_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_produtos_codigos_produto
    ON produtos_codigos (empresa_id, produto_id);

CREATE INDEX IF NOT EXISTS idx_produtos_codigos_busca
    ON produtos_codigos (empresa_id, codigo)
    WHERE ativo = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_codigos_principal
    ON produtos_codigos (empresa_id, produto_id)
    WHERE principal = true AND ativo = true;
