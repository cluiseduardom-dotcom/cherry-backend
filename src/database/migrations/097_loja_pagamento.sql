-- Loja online — fatia 3: pagamento (Mercado Pago) e conversão do pedido pago em venda.
--
-- A venda e a cobrança da loja não têm operador (a cliente é visitante). Duas colunas que exigiam usuário passam a
-- aceitar NULL. É um RELAXAMENTO: nenhuma linha existente muda e toda leitura atual continua válida (ninguém junta
-- estas colunas com `usuarios`; a listagem de vendas já usa LEFT JOIN no vendedor).
--   * cobrancas_pagamento.criado_por : NULL = cobrança criada pela loja online (sem usuário).
--   * pagamentos_venda.usuario_id    : NULL = pagamento de venda da loja online (sem usuário).
-- Comissão não se aplica (sem vendedor); a taxa da plataforma e o restante da venda seguem as regras de sempre.
--
-- Um pedido por cobrança: o índice abaixo impede ligar a mesma cobrança a dois pedidos.
-- Só relaxa e acrescenta. Reversão manual no rodapé (só é possível sem linhas com NULL nessas colunas).

ALTER TABLE cobrancas_pagamento ALTER COLUMN criado_por DROP NOT NULL;
ALTER TABLE pagamentos_venda ALTER COLUMN usuario_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_loja_cobranca
    ON pedidos_loja (empresa_id, cobranca_codigo) WHERE cobranca_codigo IS NOT NULL;

-- Reversão manual (não executada pelo runner; antes, vendas e cobranças da loja precisam de um usuário ou ser tratadas):
--   DROP INDEX IF EXISTS uq_pedidos_loja_cobranca;
--   ALTER TABLE pagamentos_venda ALTER COLUMN usuario_id SET NOT NULL;
--   ALTER TABLE cobrancas_pagamento ALTER COLUMN criado_por SET NOT NULL;
