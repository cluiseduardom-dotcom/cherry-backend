-- Limite de usuários ativos por plano e por empresa (slice 2 do desenho de planos, PO 05/11/2026).
--
-- Limite efetivo da empresa = limite do PLANO + usuarios_extras contratados; NULL no plano = sem limite.
-- Uma linha em empresa_limites_usuarios pode somar extras ou liberar sem limite (exceção negociada, como a
-- Cherry e a Valvazori), sempre com justificativa e responsável. O bloqueio acontece no backend, ao criar
-- e ao desbloquear usuário, sob a trava da empresa. Quem já passa do limite não perde ninguém: só não entra
-- usuário novo até caber.
--
-- Os planos legados (sem_mensalidade, com_mensalidade) ficam sem limite, então nenhuma empresa existente
-- é afetada por esta migration. Cortesia/Básico 3, Padrão 7, Pro 15 (hipótese de preço a validar; a composição
-- do plano só muda por migration). Aditiva e idempotente. Reversão manual no rodapé.

ALTER TABLE planos_comerciais ADD COLUMN IF NOT EXISTS limite_usuarios INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'planos_comerciais_limite_usuarios_chk') THEN
        ALTER TABLE planos_comerciais
            ADD CONSTRAINT planos_comerciais_limite_usuarios_chk CHECK (limite_usuarios IS NULL OR limite_usuarios >= 1);
    END IF;
END $$;

UPDATE planos_comerciais p
SET limite_usuarios = v.limite
FROM (VALUES ('cortesia', 3), ('basico', 3), ('padrao', 7), ('pro', 15)) AS v(codigo, limite)
WHERE p.codigo = v.codigo AND p.limite_usuarios IS NULL;

CREATE TABLE IF NOT EXISTS empresa_limites_usuarios (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    usuarios_extras INTEGER NOT NULL DEFAULT 0,
    -- true = sem limite de usuários (exceção negociada), ignora plano e extras.
    ilimitado BOOLEAN NOT NULL DEFAULT false,
    justificativa TEXT NOT NULL,
    responsavel VARCHAR(120) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT empresa_limites_usuarios_empresa_uk UNIQUE (empresa_id),
    CONSTRAINT empresa_limites_usuarios_extras_chk CHECK (usuarios_extras >= 0),
    CONSTRAINT empresa_limites_usuarios_justificativa_chk CHECK (btrim(justificativa) <> ''),
    CONSTRAINT empresa_limites_usuarios_responsavel_chk CHECK (btrim(responsavel) <> '')
);

-- Reversão manual (não executada pelo runner):
--   DROP TABLE IF EXISTS empresa_limites_usuarios;
--   ALTER TABLE planos_comerciais DROP CONSTRAINT IF EXISTS planos_comerciais_limite_usuarios_chk;
--   ALTER TABLE planos_comerciais DROP COLUMN IF EXISTS limite_usuarios;
