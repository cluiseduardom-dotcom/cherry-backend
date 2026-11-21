-- 121: o módulo PCP passa a poder ser ligado pela GiroNex (funcionalidades.vendavel = true).
--
-- Contexto: a migration 089 criou o catálogo com `pcp` como "em breve" (vendavel = false), o que impede ligá-lo
-- para uma empresa (409). Com a necessidade de material (GET /producoes/necessidade) o primeiro pedaço do PCP existe.
-- Nenhum plano inclui o PCP: a GiroNex liga avulso, por empresa, com justificativa (Painel).
-- As rotas antigas de produção e ficha técnica NÃO passam a exigir a funcionalidade; só as rotas novas do PCP.
-- Idempotente: repetir o UPDATE não muda nada.

UPDATE funcionalidades SET vendavel = true WHERE codigo = 'pcp';

-- Reversão manual (não executada pelo runner):
--   UPDATE funcionalidades SET vendavel = false WHERE codigo = 'pcp';
