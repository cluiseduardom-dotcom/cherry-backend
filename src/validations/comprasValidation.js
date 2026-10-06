const { z } = require('zod');
const { MAX_DIAS_PRAZO, MAX_ITENS_POR_DOCUMENTO, MAX_QUANTIDADE_ITEM, MAX_VALOR_MONETARIO } = require('../constants/limites');

// data_compra/data_de/data_ate ficam como string 'YYYY-MM-DD' (z.iso.date),
// nunca viram objeto Date — mesma armadilha de fuso horário já documentada em
// contas_pagar (o driver pg grava uma coluna DATE usando os métodos de fuso
// horário LOCAL do Node, não UTC; z.coerce.date() gera meia-noite UTC, que em
// fuso negativo vira o dia anterior local).
const dataISO = (mensagem) => z.iso.date({ error: mensagem });

// custo_unitario é digitado manualmente (não vem de um preço vigente
// travado, diferente de vendas): validado aqui, não recalculado depois.
// dias_prazo só é obrigatório quando forma_pagamento = 'prazo' — mesma lógica
// de vendas.dias_prazo.
const criarCompraSchema = z.object({
    fornecedor_id: z.coerce.number({ error: 'Fornecedor inválido' }).int().positive('Fornecedor inválido'),
    data_compra: dataISO('Data da compra inválida'),
    nota_fiscal: z.string().optional(),
    forma_pagamento: z.enum(['a_vista', 'prazo'], { error: 'Forma de pagamento inválida' }).optional(),
    dias_prazo: z.coerce.number({ error: 'Prazo em dias deve ser maior que zero' }).int().positive('Prazo em dias deve ser maior que zero').max(MAX_DIAS_PRAZO, `Prazo em dias deve ser no máximo ${MAX_DIAS_PRAZO}`).optional(),
    itens: z.array(
        z.object({
            produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido'),
            quantidade: z.coerce.number({ error: 'Quantidade deve ser maior que zero' }).int().positive('Quantidade deve ser maior que zero').max(MAX_QUANTIDADE_ITEM, `Quantidade deve ser no máximo ${MAX_QUANTIDADE_ITEM}`),
            custo_unitario: z.coerce.number({ error: 'Custo unitário deve ser maior que zero' }).positive('Custo unitário deve ser maior que zero').max(MAX_VALOR_MONETARIO, 'Custo unitário acima do permitido')
        }).strict()
    ).min(1, 'A compra deve ter ao menos um item').max(MAX_ITENS_POR_DOCUMENTO, `A compra deve ter no máximo ${MAX_ITENS_POR_DOCUMENTO} itens`)
}).strict().refine((data) => data.forma_pagamento !== 'prazo' || data.dias_prazo !== undefined, {
    message: 'Informe dias_prazo para compras a prazo',
    path: ['dias_prazo']
});

const listarComprasSchema = z.object({
    fornecedor_id: z.coerce.number({ error: 'Fornecedor inválido' }).int().positive('Fornecedor inválido').optional(),
    data_de: dataISO('Data inicial inválida').optional(),
    data_ate: dataISO('Data final inválida').optional()
});

module.exports = {
    criarCompraSchema,
    listarComprasSchema
};
