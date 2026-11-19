-- Teste grátis de 30 dias, cobrança manual, isenção e somente leitura (PO, 19/11/2026).
--
-- empresa_cobranca: uma linha por empresa, operada SÓ pelo Painel GiroNex (a empresa-alvo vem da rota). A situação NÃO é
-- gravada: é derivada das datas, na mesma regra em todo lugar (src/repositories/cobrancaSituacaoSql.js):
--   isenta                      -> sem cobrança, para sempre (família, parceiros), até a GiroNex remover
--   hoje <= trial_fim           -> em_teste (uso normal no plano escolhido; a taxa do Pix já vale)
--   hoje <= pago_ate            -> ativa (cobrança ligada; a GiroNex registra cada pagamento, manualmente)
--   caso contrário              -> somente_leitura (consulta e exporta; não grava nada novo)
-- Empresa SEM linha aqui (as que já existiam) não muda de comportamento: nunca entra em somente leitura.
-- Desligar a empresa continua sendo empresas.status = 'inativa' (já existente: derruba login e tokens).
-- Nada é apagado. A trilha de cada mudança fica em plataforma_eventos, na mesma transação.
--
-- Depende da migration 119 só pela numeração (a 119 ajusta os limites dos planos). Idempotente.
-- Reversão manual no rodapé.

CREATE TABLE IF NOT EXISTS empresa_cobranca (
    empresa_id    INTEGER PRIMARY KEY REFERENCES empresas (id),
    trial_inicio  DATE,
    trial_fim     DATE,
    pago_ate      DATE,
    isenta        BOOLEAN      NOT NULL DEFAULT false,
    justificativa TEXT         NOT NULL,
    responsavel   VARCHAR(120) NOT NULL,
    criado_em     TIMESTAMP    NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP    NOT NULL DEFAULT NOW(),
    CONSTRAINT empresa_cobranca_trial_chk CHECK (
        (trial_inicio IS NULL AND trial_fim IS NULL)
        OR (trial_inicio IS NOT NULL AND trial_fim IS NOT NULL AND trial_fim >= trial_inicio)
    ),
    CONSTRAINT empresa_cobranca_justificativa_chk CHECK (length(btrim(justificativa)) >= 3)
);

-- Reversão manual (não executada pelo runner):
--   DROP TABLE IF EXISTS empresa_cobranca;
