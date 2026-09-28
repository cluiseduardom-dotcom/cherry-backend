-- Liga cada movimentação de estoque gerada por uma compra (entrada, no
-- momento do recebimento) à compra que a originou. Necessário pra
-- comprasRepository.cancelar conseguir localizar precisamente as
-- movimentações de entrada da própria compra e distingui-las de qualquer
-- movimentação POSTERIOR dos mesmos produtos (venda, nova entrada, ajuste,
-- perda, transferência etc.) — issue #79: cancelamento de compra passa a
-- ser bloqueado quando existir tal movimentação, pra preservar
-- rastreabilidade. Nullable: a grande maioria das linhas de
-- movimentacoes_estoque continua sem vínculo com compra nenhuma (vendas,
-- ajuste manual, produção, cancelamento). Mesmo padrão de
-- contas_pagar.compra_id (migration 012_compras.sql), mas sem UNIQUE aqui:
-- uma compra com múltiplos itens gera várias movimentações.
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS compra_id INTEGER REFERENCES compras(id);

CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_compra_id ON movimentacoes_estoque(compra_id);
