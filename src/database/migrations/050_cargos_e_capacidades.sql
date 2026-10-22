-- Cargos por comércio (SPEC "Cargos, permissões e cancelamento de venda", PR 1).
--
-- 1) usuarios.papel passa a aceitar os novos cargos. A restrição original foi criada
--    inline no schema.sql (nome automático); aqui ela é localizada pela definição, e não
--    pelo nome, e substituída por uma restrição nomeada. Os valores antigos continuam válidos.
-- 2) cargos_empresa guarda, POR COMÉRCIO, o nível hierárquico, se o cargo está ligado e as
--    capacidades do cargo. Linha ausente = padrão do catálogo (src/constants/cargos.js):
--    nenhum comércio existente muda de comportamento. A linha, quando existe, é a verdade
--    inteira do cargo naquele comércio (inclusive "sem nenhuma capacidade").
--
-- Aditiva e idempotente. Reversão manual no rodapé.

DO $$
DECLARE
    restricao TEXT;
BEGIN
    FOR restricao IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'usuarios'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%papel%'
          AND conname <> 'usuarios_papel_chk'
    LOOP
        EXECUTE format('ALTER TABLE usuarios DROP CONSTRAINT %I', restricao);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'usuarios_papel_chk' AND conrelid = 'usuarios'::regclass) THEN
        ALTER TABLE usuarios
            ADD CONSTRAINT usuarios_papel_chk CHECK (papel IN (
                'admin', 'diretor', 'gerente', 'coordenador', 'supervisor', 'analista',
                'vendedor', 'operador', 'auxiliar', 'estoquista', 'faturista'
            ));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS cargos_empresa (
    empresa_id    INTEGER      NOT NULL REFERENCES empresas(id),
    cargo         VARCHAR(20)  NOT NULL,
    nivel         INTEGER,
    ativo         BOOLEAN      NOT NULL DEFAULT false,
    capacidades   TEXT[]       NOT NULL DEFAULT '{}',
    atualizado_por INTEGER     REFERENCES usuarios(id),
    atualizado_em TIMESTAMP    NOT NULL DEFAULT NOW(),
    PRIMARY KEY (empresa_id, cargo),
    CONSTRAINT cargos_empresa_cargo_chk CHECK (cargo IN (
        'diretor', 'gerente', 'coordenador', 'supervisor', 'analista',
        'vendedor', 'operador', 'auxiliar', 'estoquista', 'faturista'
    )),
    CONSTRAINT cargos_empresa_nivel_chk CHECK (nivel IS NULL OR (nivel >= 1 AND nivel <= 89))
);

CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_papel ON usuarios(empresa_id, papel);

-- Reversão manual (não executada pelo runner; só se nenhum usuário usar os cargos novos):
--   DROP TABLE IF EXISTS cargos_empresa;
--   DROP INDEX IF EXISTS idx_usuarios_empresa_papel;
--   ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_chk;
--   ALTER TABLE usuarios ADD CONSTRAINT usuarios_papel_check
--       CHECK (papel IN ('admin', 'vendedor', 'estoquista'));
