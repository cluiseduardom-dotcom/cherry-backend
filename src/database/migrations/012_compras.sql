-- Compras: registro de compra de fornecedor que gera movimentação de estoque
-- (entrada, reaproveitando estoqueRepository.criarMovimentacao) e, se a
-- prazo, gera conta a pagar automaticamente (mesmo padrão de vendas/
-- contas_receber, tudo na mesma transação). Sem CRUD manual depois de
-- criada: só cancelamento (soft, via status), nunca DELETE físico.
--
-- status só tem 'recebido' de verdade por enquanto (toda compra registrada
-- aqui já entra no estoque na hora — não existe fluxo de "pedido" ainda),
-- mas o CHECK já inclui 'pendente' pra permitir evoluir pra um fluxo formal
-- de pedido (pendente -> recebido) sem migration nova depois. 'cancelado' é
-- usado desde já pelo cancelamento (PATCH /compras/:id/cancelar).
--
-- valor_total é calculado a partir dos itens (quantidade * custo_unitario),
-- gravado como 0 na criação da linha e atualizado depois de inserir os itens
-- na mesma transação — mesmo padrão de vendas.total (por isso não tem CHECK
-- valor_total > 0: a linha existe momentaneamente com 0 dentro da transação).

CREATE TABLE IF NOT EXISTS compras (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    fornecedor_id INTEGER NOT NULL REFERENCES fornecedores(id),
    data_compra DATE NOT NULL,
    nota_fiscal VARCHAR(50),
    forma_pagamento VARCHAR(20) NOT NULL DEFAULT 'a_vista' CHECK (forma_pagamento IN ('a_vista', 'prazo')),
    dias_prazo INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'recebido' CHECK (status IN ('recebido', 'pendente', 'cancelado')),
    valor_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS itens_compra (
    id SERIAL PRIMARY KEY,
    compra_id INTEGER NOT NULL REFERENCES compras(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    quantidade INTEGER NOT NULL,
    custo_unitario NUMERIC(10, 2) NOT NULL
);

-- Vínculo opcional de contas_pagar com a compra que a gerou (só quando
-- forma_pagamento = 'prazo'), mesmo padrão de contas_receber.venda_id.
-- Necessário pra PATCH /compras/:id/cancelar conseguir achar e cancelar a
-- conta a pagar vinculada. Nullable porque a maioria das linhas de
-- contas_pagar continua sendo lançamento manual, sem compra nenhuma por trás.
-- Divergência em relação ao pedido original (que só mencionava as tabelas
-- compras/itens_compra): sem esse vínculo não daria pra cancelar a conta a
-- pagar certa a partir do cancelamento da compra.
ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS compra_id INTEGER UNIQUE REFERENCES compras(id);

CREATE INDEX IF NOT EXISTS idx_compras_empresa_id ON compras(empresa_id);
CREATE INDEX IF NOT EXISTS idx_compras_fornecedor_id ON compras(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_compras_data_compra ON compras(data_compra);
CREATE INDEX IF NOT EXISTS idx_itens_compra_compra_id ON itens_compra(compra_id);
CREATE INDEX IF NOT EXISTS idx_itens_compra_produto_id ON itens_compra(produto_id);
CREATE INDEX IF NOT EXISTS idx_itens_compra_empresa_id ON itens_compra(empresa_id);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_compra_id ON contas_pagar(compra_id);
