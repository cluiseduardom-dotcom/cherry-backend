-- Configuração de pagamento de comissão por empresa.
--
-- modo_pagamento:
--   'liberada'    (padrão, vale quando a empresa não tem linha): a comissão liberada já pode ser paga.
--   'fim_do_mes'  : só entram no "a pagar" as comissões de vendas de MESES JÁ FECHADOS (venda anterior ao
--                   dia 1 do mês corrente, fuso America/Sao_Paulo) e o que já tem pagamento/desconto
--                   registrado. Vendas do mês corrente ficam "aguardando fechamento".
--
-- A regra só filtra o que pode ser PAGO; apuração e liberação (comissoes_venda) não mudam.
-- Só o admin altera (rota); atualizado_por/atualizado_em registram quem e quando.
-- Migration só aditiva.

CREATE TABLE IF NOT EXISTS comissao_configuracoes (
    empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id),
    modo_pagamento VARCHAR(20) NOT NULL DEFAULT 'liberada'
        CHECK (modo_pagamento IN ('liberada', 'fim_do_mes')),
    atualizado_por INTEGER NOT NULL,
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT comissao_configuracoes_autor_empresa_fk
        FOREIGN KEY (atualizado_por, empresa_id) REFERENCES usuarios (id, empresa_id)
);

-- Reversão manual: DROP TABLE IF EXISTS comissao_configuracoes;
