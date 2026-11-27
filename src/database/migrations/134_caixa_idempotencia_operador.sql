-- 134: caixa por PDV (Tarefa 03, PR B). Duas garantias que a 133 não deixou no banco. Só acrescenta; idempotente.
--
--  1. caixa_movimentos.chave_idempotencia: um retry de rede de uma sangria/suprimento não pode lançar o dinheiro duas vezes.
--     A coluna é opcional no banco (a tabela é insere-só e pode já ter linhas); a rota exige o cabeçalho Idempotency-Key.
--     Único por empresa quando preenchida; a mesma chave com o mesmo conteúdo devolve o movimento original (a rota compara).
--  2. Uma sessão aberta por OPERADOR: a mesma pessoa não opera dois caixas ao mesmo tempo (a venda de PR C precisa saber
--     em qual caixa o operador está). O banco impõe, sem corrida entre duas aberturas simultâneas.
--
-- Nenhuma linha existente é alterada. ALTER TABLE ... ADD COLUMN IF NOT EXISTS não dispara os gatilhos de UPDATE/DELETE.

ALTER TABLE caixa_movimentos ADD COLUMN IF NOT EXISTS chave_idempotencia VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_movimentos_chave
    ON caixa_movimentos (empresa_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_sessoes_uma_aberta_por_operador
    ON caixa_sessoes (operador_id) WHERE status = 'aberta';

-- Reversão manual (não executada pelo runner):
--   DROP INDEX IF EXISTS uq_caixa_sessoes_uma_aberta_por_operador;
--   DROP INDEX IF EXISTS uq_caixa_movimentos_chave;
--   ALTER TABLE caixa_movimentos DROP COLUMN IF EXISTS chave_idempotencia;
