-- Identidade por cliente (login com a marca de cada empresa) e trilha das mudanças.
--
-- * empresas.slug: identificador curto e público da empresa na URL de login (/c/<slug>). Anulável e
--   único; só minúsculas, números e hífen. Quem define é o operador da plataforma, nunca o cliente.
-- * O tema 'valvazori' entra no conjunto fechado do frontend (o backend só guarda o identificador).
-- * empresas_identidade_eventos: quem mudou tema/slug, de quê para quê e quando.
-- * A Cherry Semijoias ganha o slug 'cherry' (mesma regra de nome usada na 049), sem sobrescrever
--   um slug já definido nem colidir com outro.
--
-- Aditiva e idempotente. Reversão manual no rodapé.

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS slug VARCHAR(40);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conname = 'empresas_slug_chk' AND conrelid = 'empresas'::regclass) THEN
        ALTER TABLE empresas
            ADD CONSTRAINT empresas_slug_chk CHECK (slug IS NULL OR slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$');
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_empresas_slug ON empresas (slug) WHERE slug IS NOT NULL;

ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_tema_visual_chk;
ALTER TABLE empresas
    ADD CONSTRAINT empresas_tema_visual_chk CHECK (tema_visual IN ('vertumno', 'cherry', 'valvazori'));

UPDATE empresas SET slug = 'cherry'
WHERE nome = 'Cherry Semijoias' AND slug IS NULL
  AND NOT EXISTS (SELECT 1 FROM empresas outra WHERE outra.slug = 'cherry');

CREATE TABLE IF NOT EXISTS empresas_identidade_eventos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    tema_anterior VARCHAR(30),
    tema_novo VARCHAR(30),
    slug_anterior VARCHAR(40),
    slug_novo VARCHAR(40),
    responsavel VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_empresas_identidade_eventos_empresa ON empresas_identidade_eventos (empresa_id, criado_em DESC);

-- Reversão manual (não executada pelo runner; antes, nenhuma empresa pode usar o tema 'valvazori'):
--   DROP TABLE IF EXISTS empresas_identidade_eventos;
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_tema_visual_chk;
--   ALTER TABLE empresas ADD CONSTRAINT empresas_tema_visual_chk CHECK (tema_visual IN ('vertumno', 'cherry'));
--   DROP INDEX IF EXISTS ux_empresas_slug;
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_slug_chk;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS slug;
