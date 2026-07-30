-- Contas a receber: segunda etapa do módulo financeiro, com vínculo automático
-- a vendas (diferente de contas_pagar, que é lançamento manual sem vínculo).
-- Uma conta a receber só nasce de uma venda com forma_pagamento = 'prazo' —
-- venda à vista já é dinheiro recebido na hora, não entra no fluxo de "a
-- receber". Não existe endpoint de criação/edição manual: toda linha nasce de
-- POST /vendas (vendasRepository.criar) e é cancelada automaticamente por
-- PATCH /vendas/:id/cancelar enquanto ainda estiver 'pendente' — se já tiver
-- sido recebida, o dinheiro já entrou e a conta não é mexida.
--
-- valor é copiado de vendas.total no momento da criação e nunca recalculado
-- depois, mesma filosofia de preco_unitario em itens_venda.
--
-- status segue o mesmo padrão de contas_pagar: só 3 valores persistidos
-- ('pendente', 'recebido', 'cancelado'); "atrasado" é campo calculado na
-- leitura (status = 'pendente' AND data_vencimento < hoje), não uma coluna —
-- não existe job/cron no projeto pra manter um 4º status sincronizado com a
-- data atual.
--
-- data_vencimento/data_recebimento são DATE, não TIMESTAMP: são datas de
-- calendário, sem significado de hora do dia (mesma armadilha de fuso horário
-- documentada em 006_contas_pagar.sql vale aqui).

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(20) NOT NULL DEFAULT 'a_vista'
    CHECK (forma_pagamento IN ('a_vista', 'prazo'));

CREATE TABLE IF NOT EXISTS contas_receber (
    id SERIAL PRIMARY KEY,
    venda_id INTEGER NOT NULL UNIQUE REFERENCES vendas(id),
    descricao VARCHAR(255) NOT NULL,
    valor NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    data_vencimento DATE NOT NULL,
    data_recebimento DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'recebido', 'cancelado')),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contas_receber_status ON contas_receber(status);
CREATE INDEX IF NOT EXISTS idx_contas_receber_vencimento ON contas_receber(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_contas_receber_empresa_id ON contas_receber(empresa_id);
