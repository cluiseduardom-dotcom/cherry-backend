-- Foto de perfil do usuário (uma por usuário). O arquivo fica no armazenamento de objetos (Cloudflare R2,
-- o mesmo das fotos de produto); o banco guarda só a CHAVE do objeto e os metadados.
--
-- chave: `<empresa_id>/usuarios/<usuario_id>/<uuid>.<ext>`, sempre gerada pelo backend (nunca vem do cliente).
-- Trocar a foto cria uma chave nova (cache longo e imutável) e a anterior é apagada do bucket depois do commit.
-- FK composta (usuario_id, empresa_id): a foto é sempre da mesma empresa do usuário. Migration só aditiva.

CREATE TABLE IF NOT EXISTS usuarios_fotos (
    usuario_id INTEGER PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    chave VARCHAR(300) NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    tamanho_bytes INTEGER NOT NULL,
    atualizado_por INTEGER,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT usuarios_fotos_usuario_fk FOREIGN KEY (usuario_id, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT usuarios_fotos_atualizado_por_fk FOREIGN KEY (atualizado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT usuarios_fotos_chave_uk UNIQUE (chave),
    CONSTRAINT usuarios_fotos_content_type_chk CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT usuarios_fotos_tamanho_chk CHECK (tamanho_bytes > 0)
);

CREATE INDEX IF NOT EXISTS idx_usuarios_fotos_empresa ON usuarios_fotos (empresa_id);

-- Reversão manual: DROP TABLE usuarios_fotos;  (os objetos no bucket não são apagados por isso)
