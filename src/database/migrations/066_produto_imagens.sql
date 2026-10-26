-- Fotos de produto (galeria de até 5 por produto). O arquivo fica no armazenamento de objetos (Cloudflare R2,
-- compatível com S3); o banco guarda só a CHAVE do objeto e os metadados.
--
-- chave: caminho no bucket, sempre `<empresa_id>/produtos/<produto_id>/<uuid>.<ext>` (gerado pelo backend).
-- ordem: 0 é a foto principal (a que aparece no card). O limite de 5 por produto é aplicado no backend,
--        sob trava da linha do produto.
-- FK composta (produto_id, empresa_id): a foto é sempre da mesma empresa do produto. Migration só aditiva.

CREATE TABLE IF NOT EXISTS produto_imagens (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL,
    chave VARCHAR(300) NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    tamanho_bytes INTEGER NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 0,
    criado_por INTEGER,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT produto_imagens_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
    CONSTRAINT produto_imagens_criado_por_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT produto_imagens_chave_uk UNIQUE (chave),
    CONSTRAINT produto_imagens_content_type_chk CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT produto_imagens_tamanho_chk CHECK (tamanho_bytes > 0),
    CONSTRAINT produto_imagens_ordem_chk CHECK (ordem >= 0)
);

CREATE INDEX IF NOT EXISTS idx_produto_imagens_produto ON produto_imagens (empresa_id, produto_id, ordem);

-- Reversão manual: DROP TABLE produto_imagens;  (os objetos no bucket não são apagados por isso)
