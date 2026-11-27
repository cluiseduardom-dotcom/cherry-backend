-- 135: caixa por PDV (Tarefa 03, PR C): liga pagamento de venda e estorno à sessão de caixa. Só acrescenta; idempotente.
--
-- pagamentos_venda.caixa_sessao_id : em qual sessão de caixa o pagamento entrou (NULL = fora de caixa: empresa sem a funcionalidade
--                                    `caixa`, venda da loja online, histórico). Nenhuma linha existente é alterada.
-- estornos_pagamento.caixa_sessao_id: de qual sessão o dinheiro/valor SAIU no estorno (a sessão do pagamento original, se ainda
--                                    aberta; senão a do operador que estorna; senão NULL).
-- Referência composta (id, empresa_id): o banco recusa sessão de outra empresa. Entram NOT VALID e são validadas em seguida
-- (mesmo padrão da 132); as colunas novas são NULL, então a validação é imediata.
-- Gatilho: pagamento/estorno só entra em sessão ABERTA (FOR SHARE trava a sessão contra um fechamento concorrente: ou o pagamento
-- entra antes do fechamento e conta na conferência, ou o fechamento vence e o pagamento é recusado). UPDATE/DELETE não são tocados.

ALTER TABLE pagamentos_venda ADD COLUMN IF NOT EXISTS caixa_sessao_id INTEGER;
ALTER TABLE estornos_pagamento ADD COLUMN IF NOT EXISTS caixa_sessao_id INTEGER;

DO $$
DECLARE
    alvo RECORD;
BEGIN
    FOR alvo IN SELECT * FROM (VALUES
        ('pagamentos_venda', 'pagamentos_venda_caixa_sessao_empresa_fk'),
        ('estornos_pagamento', 'estornos_pagamento_caixa_sessao_empresa_fk')
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

CREATE INDEX IF NOT EXISTS idx_pagamentos_venda_caixa_sessao ON pagamentos_venda (empresa_id, caixa_sessao_id) WHERE caixa_sessao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estornos_pagamento_caixa_sessao ON estornos_pagamento (empresa_id, caixa_sessao_id) WHERE caixa_sessao_id IS NOT NULL;

CREATE OR REPLACE FUNCTION caixa_pagamento_exige_sessao_aberta() RETURNS trigger AS $$
DECLARE
    situacao VARCHAR(10);
BEGIN
    SELECT status INTO situacao FROM caixa_sessoes WHERE id = NEW.caixa_sessao_id AND empresa_id = NEW.empresa_id FOR SHARE;

    IF situacao IS DISTINCT FROM 'aberta' THEN
        RAISE EXCEPTION 'a sessão de caixa não está aberta' USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pagamentos_venda_caixa_aberto ON pagamentos_venda;
CREATE TRIGGER trg_pagamentos_venda_caixa_aberto
    BEFORE INSERT ON pagamentos_venda
    FOR EACH ROW WHEN (NEW.caixa_sessao_id IS NOT NULL)
    EXECUTE FUNCTION caixa_pagamento_exige_sessao_aberta();

DROP TRIGGER IF EXISTS trg_estornos_pagamento_caixa_aberto ON estornos_pagamento;
CREATE TRIGGER trg_estornos_pagamento_caixa_aberto
    BEFORE INSERT ON estornos_pagamento
    FOR EACH ROW WHEN (NEW.caixa_sessao_id IS NOT NULL)
    EXECUTE FUNCTION caixa_pagamento_exige_sessao_aberta();

-- Reversão manual (não executada pelo runner; só vale se não há pagamentos ligados a preservar):
--   DROP TRIGGER IF EXISTS trg_estornos_pagamento_caixa_aberto ON estornos_pagamento;
--   DROP TRIGGER IF EXISTS trg_pagamentos_venda_caixa_aberto ON pagamentos_venda;
--   DROP FUNCTION IF EXISTS caixa_pagamento_exige_sessao_aberta();
--   ALTER TABLE estornos_pagamento DROP COLUMN IF EXISTS caixa_sessao_id;
--   ALTER TABLE pagamentos_venda DROP COLUMN IF EXISTS caixa_sessao_id;
