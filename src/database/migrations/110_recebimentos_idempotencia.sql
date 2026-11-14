-- Recebimento parcial de contas a receber: idempotência por recebimento.
--
-- * `recebimentos_conta` já guarda cada recebimento de uma parcela (valor, forma, quem, quando). Com recebimento PARCIAL, o
--   mesmo clique repetido (retry, duplo clique, queda de conexão) lançaria o dinheiro duas vezes. A nova coluna guarda a
--   chave de idempotência enviada pelo cliente: repetir a mesma chave com o mesmo conteúdo devolve o recebimento original.
-- * Nasce NULL: recebimentos antigos e os que não enviam chave seguem como sempre. A unicidade vale só quando há chave.
-- * Só acrescenta. Idempotente. Reversão manual no rodapé.

ALTER TABLE recebimentos_conta
    ADD COLUMN IF NOT EXISTS chave_idempotencia VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recebimentos_conta_chave
    ON recebimentos_conta (empresa_id, chave_idempotencia)
    WHERE chave_idempotencia IS NOT NULL;

-- Reversão manual (não executada pelo runner; só depois de reverter o código que usa a coluna):
--   DROP INDEX IF EXISTS uq_recebimentos_conta_chave;
--   ALTER TABLE recebimentos_conta DROP COLUMN IF EXISTS chave_idempotencia;
