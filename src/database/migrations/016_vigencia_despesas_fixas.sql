-- Migration 016: vigência em despesas_fixas + rateio do custo fixo no
-- Ponto de Equilíbrio.
-- Hoje despesasFixasRepository.somarAtivas soma o valor mensal cheio de
-- toda despesa com ativo = true, sem considerar o período consultado nem
-- quando a despesa passou a existir — um período de 7 dias é comparado
-- contra um mês inteiro de custo fixo, e cadastrar/desativar uma despesa
-- hoje muda o resultado de meses já fechados (mesma classe de bug já
-- corrigida para custo/preço de venda na migration 015).
--
-- vigencia_inicio/vigencia_fim passam a ser a fonte de verdade cronológica
-- pro Ponto de Equilíbrio; ativo continua existindo como pausa de exceção
-- manual (nunca conta enquanto false, independente de vigência) — não é
-- substituído, os dois convivem.
--
-- Tabela vazia em produção/staging/ci-test (confirmado): backfill é no-op
-- em todos os ambientes.

ALTER TABLE despesas_fixas ADD COLUMN vigencia_inicio DATE;

UPDATE despesas_fixas
SET vigencia_inicio = criado_em::date
WHERE vigencia_inicio IS NULL;

ALTER TABLE despesas_fixas ALTER COLUMN vigencia_inicio SET NOT NULL;

ALTER TABLE despesas_fixas ADD COLUMN vigencia_fim DATE;

ALTER TABLE despesas_fixas
ADD CONSTRAINT despesas_fixas_vigencia_check
CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio);
