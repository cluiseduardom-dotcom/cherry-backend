-- Rótulo por empresa do estoque que fica com o vendedor: "Maleta" (semijoias) ou "Estoque do vendedor" (demais ramos).
--
-- * Só muda o VOCABULÁRIO mostrado ao usuário. O tipo técnico do local continua `maleta`: estoque, transferência com aceite,
--   acerto, comissão e venda pelo PDV seguem exatamente iguais.
-- * Empresas que já existem ficam com 'maleta' (nada muda para elas). Empresas novas nascem com 'estoque_vendedor'.
-- * Lista fechada (CHECK): o texto exibido vem do código, nunca digitado livremente (concordância e gênero controlados).
-- * Só acrescenta. Idempotente. Reversão manual no rodapé.

ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS rotulo_estoque_vendedor VARCHAR(20) NOT NULL DEFAULT 'maleta';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empresas_rotulo_estoque_vendedor_chk') THEN
        ALTER TABLE empresas
            ADD CONSTRAINT empresas_rotulo_estoque_vendedor_chk CHECK (rotulo_estoque_vendedor IN ('maleta', 'estoque_vendedor'));
    END IF;
END $$;

-- As linhas existentes já receberam 'maleta' acima; a partir daqui, empresa nova nasce com o padrão neutro.
ALTER TABLE empresas ALTER COLUMN rotulo_estoque_vendedor SET DEFAULT 'estoque_vendedor';

-- Reversão manual (não executada pelo runner; só depois de reverter o código que lê a coluna):
--   ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_rotulo_estoque_vendedor_chk;
--   ALTER TABLE empresas DROP COLUMN IF EXISTS rotulo_estoque_vendedor;
