-- Financeiro (primeira etapa): contas a pagar, lançamento manual, sem vínculo
-- automático com vendas. Contas a receber fica para uma etapa futura.
--
-- status tem só 3 valores reais ('pendente', 'pago', 'cancelado') — "atrasado"
-- não é um status persistido, é calculado na resposta a partir de
-- (status = 'pendente' AND data_vencimento < hoje), no mesmo espírito de
-- produtosService.comMargem (campo derivado, nunca gravado). Isso evita
-- precisar de um job/cron pra manter um 4º status sincronizado com a data
-- atual — não existe infraestrutura de job agendado neste projeto ainda.
--
-- data_vencimento/data_pagamento são DATE (não TIMESTAMP): são datas de
-- calendário, sem significado de hora do dia.

CREATE TABLE IF NOT EXISTS contas_pagar (
    id SERIAL PRIMARY KEY,
    descricao VARCHAR(255) NOT NULL,
    fornecedor VARCHAR(255),
    valor NUMERIC(10, 2) NOT NULL CHECK (valor > 0),
    data_vencimento DATE NOT NULL,
    data_pagamento DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
    categoria VARCHAR(100),
    observacao TEXT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contas_pagar_status ON contas_pagar(status);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_vencimento ON contas_pagar(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_contas_pagar_usuario_id ON contas_pagar(usuario_id);
