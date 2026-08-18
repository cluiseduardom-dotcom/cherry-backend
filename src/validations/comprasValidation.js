const { z } = require('zod');

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
    dias_prazo: z.coerce.number({ error: 'Prazo em dias deve ser maior que zero' }).int().positive('Prazo em dias deve ser maior que zero').optional(),
    itens: z.array(
        z.object({
            produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido'),
            quantidade: z.coerce.number({ error: 'Quantidade deve ser maior que zero' }).int().positive('Quantidade deve ser maior que zero'),
            custo_unitario: z.coerce.number({ error: 'Custo unitário deve ser maior que zero' }).positive('Custo unitário deve ser maior que zero')
        }).strict()
    ).min(1, 'A compra deve ter ao menos um item')
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
