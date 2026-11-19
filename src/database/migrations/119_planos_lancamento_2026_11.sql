-- Planos de lançamento do Vertumno (PO, 17-18/11/2026): Básico (Semente/Pérola) 1 usuário, Padrão (Cultivo/Esmeralda)
-- 4 usuários, Pro (Pomar/Safira) sem limite de usuários; Fiado e Importação de lista passam a vir em todos os três.
-- O preço da mensalidade NÃO fica aqui: vive no site (assets/config.js).
--
-- Só muda o que ainda está no valor original (5, 7 e 15, da migration 092/090): nunca sobrescreve ajuste posterior.
-- Quem já passa do novo limite não perde ninguém: o limite só barra a criação ou o desbloqueio de usuário (migration 090).
-- A Cortesia (3 usuários) não muda. Cherry e Valvazori precisam estar com exceção própria (empresa_limites_usuarios,
-- "sem limite") ANTES desta migration em produção, se estiverem em Básico ou Padrão.
-- loja_online segue avulsa (módulo à parte). Idempotente. Reversão manual no rodapé.

UPDATE planos_comerciais SET limite_usuarios = 1    WHERE codigo = 'basico' AND limite_usuarios = 5;
UPDATE planos_comerciais SET limite_usuarios = 4    WHERE codigo = 'padrao' AND limite_usuarios = 7;
UPDATE planos_comerciais SET limite_usuarios = NULL WHERE codigo = 'pro'    AND limite_usuarios = 15;

INSERT INTO plano_funcionalidades (plano_id, funcionalidade)
SELECT p.id, f.codigo
FROM planos_comerciais p
CROSS JOIN funcionalidades f
WHERE p.codigo IN ('basico', 'padrao', 'pro')
  AND f.codigo IN ('fiado', 'importacao_lista')
ON CONFLICT (plano_id, funcionalidade) DO NOTHING;

-- Reversão manual (não executada pelo runner):
--   UPDATE planos_comerciais SET limite_usuarios = 5  WHERE codigo = 'basico' AND limite_usuarios = 1;
--   UPDATE planos_comerciais SET limite_usuarios = 7  WHERE codigo = 'padrao' AND limite_usuarios = 4;
--   UPDATE planos_comerciais SET limite_usuarios = 15 WHERE codigo = 'pro'    AND limite_usuarios IS NULL;
--   DELETE FROM plano_funcionalidades WHERE funcionalidade IN ('fiado', 'importacao_lista')
--     AND plano_id IN (SELECT id FROM planos_comerciais WHERE codigo IN ('basico', 'padrao', 'pro'));
