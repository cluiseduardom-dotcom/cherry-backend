-- 127: funcionalidade `compras_avancado` (pedido de compra → recebimento → estoque e conta a pagar).
--
-- O backend de pedidos de compra, recebimento, conferência e integração (estoque, conta a pagar, evento de negócio) já existia,
-- mas não havia rota para CRIAR o pedido de compra, e o recebimento exige um pedido. Esta etapa expõe o pedido (rotas
-- /pedidos-compra) atrás desta funcionalidade; as compras diretas (/compras) e as rotas de /recebimentos continuam abertas
-- como sempre foram. A GiroNex liga avulso, por empresa; nenhum plano a inclui. Sem tabela nova. Idempotente.

INSERT INTO funcionalidades (codigo, nome, tipo, vendavel) VALUES
    ('compras_avancado', 'Compras avançado: pedido de compra e recebimento com conferência', 'modulo', true)
ON CONFLICT (codigo) DO NOTHING;

-- Reversão manual (não executada pelo runner):
--   DELETE FROM funcionalidades WHERE codigo = 'compras_avancado';
