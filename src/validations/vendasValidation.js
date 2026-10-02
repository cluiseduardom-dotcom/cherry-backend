const { z } = require('zod');

const pagamentoSchema = z.object({
    forma_pagamento: z.enum(['pix', 'dinheiro', 'debito', 'credito', 'crediario'], { error: 'Forma de pagamento inválida' }),
    valor: z.coerce.number({ error: 'Valor do pagamento inválido' }).positive('Valor do pagamento deve ser maior que zero'),
    valor_recebido: z.coerce.number({ error: 'Valor recebido inválido' }).nonnegative('Valor recebido não pode ser negativo').optional(),
    numero_parcelas: z.coerce.number({ error: 'Número de parcelas inválido' }).int().positive('Número de parcelas deve ser maior que zero').optional(),
    meses_prazo: z.coerce.number({ error: 'Prazo em meses inválido' }).int().positive('Prazo em meses deve ser maior que zero').optional(),
    observacao: z.string().max(500, 'Observação muito longa').optional()
}).strict();

const criarVendaSchema = z.object({
    cliente_id: z.coerce.number({ error: 'Cliente inválido' }).int().positive('Cliente inválido').optional(),
    canal: z.string().min(1, 'Canal inválido').optional(),

    // Modelo novo: uma venda pode possuir N pagamentos.
    pagamentos: z.array(pagamentoSchema).min(1, 'Informe ao menos um pagamento').optional(),

    // Compatibilidade temporária com o contrato legado.
    forma_pagamento: z.enum(['a_vista', 'prazo'], { error: 'Forma de pagamento inválida' }).optional(),
    meses_prazo: z.coerce.number({ error: 'Prazo em meses deve ser maior que zero' }).int().positive('Prazo em meses deve ser maior que zero').optional(),

    desconto: z.coerce.number({ error: 'Desconto inválido' }).nonnegative('Desconto não pode ser negativo').optional(),
    juros: z.coerce.number({ error: 'Juros inválidos' }).nonnegative('Juros não podem ser negativos').optional(),

    itens: z.array(
        z.object({
            produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido'),
            quantidade: z.coerce.number({ error: 'Quantidade deve ser maior que zero' }).int().positive('Quantidade deve ser maior que zero'),
            kit_id: z.coerce.number({ error: 'kit_id inválido' }).int().positive('kit_id inválido').nullish()
        }).strict()
    ).min(1, 'A venda deve ter ao menos um item')
}).strict().superRefine((data, ctx) => {
    const contagemPorKit = new Map();

    for (const item of data.itens) {
        if (item.kit_id == null) continue;
        contagemPorKit.set(item.kit_id, (contagemPorKit.get(item.kit_id) ?? 0) + 1);
    }

    if (![...contagemPorKit.values()].every((quantidade) => quantidade >= 2)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Kit precisa ter ao menos 2 componentes', path: ['itens'] });
    }

    if (data.pagamentos && data.forma_pagamento) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Use pagamentos ou forma_pagamento legado, não ambos',
            path: ['pagamentos']
        });
    }

    const pagamentosCrediario = data.pagamentos?.filter((p) => p.forma_pagamento === 'crediario') ?? [];

    if (pagamentosCrediario.length > 0 && data.cliente_id == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Crediário exige cliente identificado', path: ['cliente_id'] });
    }

    for (const [index, pagamento] of (data.pagamentos ?? []).entries()) {
        if (pagamento.forma_pagamento === 'crediario' && (pagamento.numero_parcelas ?? 1) > 1 && pagamento.meses_prazo == null) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe meses_prazo para crediário parcelado', path: ['pagamentos', index, 'meses_prazo'] });
        }
    }

    if (data.forma_pagamento === 'prazo' && data.meses_prazo == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe meses_prazo para vendas a prazo', path: ['meses_prazo'] });
    }
});

module.exports = { criarVendaSchema };
