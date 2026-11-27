-- 136: caixa por PDV (Tarefa 03, PR D): o dinheiro (e demais formas) recebido no balcão por parcela/conta a receber e por fiado
-- passa a entrar na conferência da sessão de caixa. Só acrescenta; idempotente; nenhuma linha existente muda.
--
-- recebimentos_conta.caixa_sessao_id : sessão aberta de quem recebeu a parcela (NULL = fora de caixa).
-- fiado_lancamentos.caixa_sessao_id  : sessão aberta de quem lançou o pagamento do cliente, ou de onde SAIU o valor num estorno
--                                      de pagamento (NULL = fora de caixa). Compra de fiado não é dinheiro e fica sempre NULL.
-- Mesmo desenho da 135: referência composta (id, empresa_id) NOT VALID + VALIDATE, índice parcial e o mesmo gatilho "só em sessão
-- aberta" (caixa_pagamento_exige_sessao_aberta, criado na 135). UPDATE/DELETE não são tocados (fiado_lancamentos segue insere-só).

ALTER TABLE recebimentos_conta ADD COLUMN IF NOT EXISTS caixa_sessao_id INTEGER;
ALTER TABLE fiado_lancamentos ADD COLUMN IF NOT EXISTS caixa_sessao_id INTEGER;

DO $$
DECLARE
    alvo RECORD;
BEGIN
    FOR alvo IN SELECT * FROM (VALUES
        ('recebimentos_conta', 'recebimentos_conta_caixa_sessao_empresa_fk'),
        ('fiado_lancamentos', 'fiado_lancamentos_caixa_sessao_empresa_fk')
    ) AS t(tabela, restricao)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = alvo.restricao AND conrelid = alvo.tabela::regclass) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (caixa_sessao_id, empresa_id) REFERENCES caixa_sessoes (id, empresa_id) NOT VALID',
                alvo.tabela, alvo.restricao
            );
        END IF;

        EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', alvo.tabela, alvo.restricao);
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_recebimentos_conta_caixa_sessao ON recebimentos_conta (empresa_id, caixa_sessao_id) WHERE caixa_sessao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiado_lancamentos_caixa_sessao ON fiado_lancamentos (empresa_id, caixa_sessao_id) WHERE caixa_sessao_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_recebimentos_conta_caixa_aberto ON recebimentos_conta;
CREATE TRIGGER trg_recebimentos_conta_caixa_aberto
    BEFORE INSERT ON recebimentos_conta
    FOR EACH ROW WHEN (NEW.caixa_sessao_id IS NOT NULL)
    EXECUTE FUNCTION caixa_pagamento_exige_sessao_aberta();

DROP TRIGGER IF EXISTS trg_fiado_lancamentos_caixa_aberto ON fiado_lancamentos;
CREATE TRIGGER trg_fiado_lancamentos_caixa_aberto
    BEFORE INSERT ON fiado_lancamentos
    FOR EACH ROW WHEN (NEW.caixa_sessao_id IS NOT NULL)
    EXECUTE FUNCTION caixa_pagamento_exige_sessao_aberta();

-- Reversão manual (não executada pelo runner; só vale se não há lançamentos ligados a preservar):
--   DROP TRIGGER IF EXISTS trg_fiado_lancamentos_caixa_aberto ON fiado_lancamentos;
--   DROP TRIGGER IF EXISTS trg_recebimentos_conta_caixa_aberto ON recebimentos_conta;
--   ALTER TABLE fiado_lancamentos DROP COLUMN IF EXISTS caixa_sessao_id;
--   ALTER TABLE recebimentos_conta DROP COLUMN IF EXISTS caixa_sessao_id;
