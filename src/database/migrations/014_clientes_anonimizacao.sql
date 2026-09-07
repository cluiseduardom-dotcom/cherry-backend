-- Migration 014: anonimização de dados pessoais de clientes (LGPD).
-- Direito de remoção de dados de contato, preservando o registro da venda
-- (obrigação fiscal) — só o cadastro do cliente é alterado, `vendas.cliente_id`
-- nunca é tocado.
--
-- Divergência: a tabela `clientes` não tinha `ativo` (nem `criado_em`/
-- `atualizado_em`) — só `id, empresa_id, nome, telefone, email`. O soft
-- delete pedido (`ativo = false`, mesmo padrão já usado em produtos/
-- fornecedores) depende dessa coluna, que não existia e foi adicionada aqui.
-- `criado_em`/`atualizado_em` não foram adicionados: não fazem parte do que
-- foi pedido nesta tarefa, retrofitar timestamp em cadastro existente é
-- decisão separada.

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS anonimizado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS anonimizado_em TIMESTAMP;
