const { z } = require('zod');

// preco_unitario nunca é aceito do cliente: o preço de cada item é sempre o
// preço vigente do produto no canal informado (módulo de precificação),
// travado no momento da criação da venda.
//
// dias_prazo só é obrigatório quando forma_pagamento = 'prazo': é ele que
// define data_vencimento da conta a receber gerada (data da venda + dias_prazo),
// dentro da mesma transação de vendasRepository.criar. Venda à vista não gera
// conta a receber, então dias_prazo não se aplica.
const criarVendaSchema = z.object({
    cliente_id: z.coerce.number({ error: 'Cliente inválido' }).int().positive('Cliente inválido').optional(),
    canal: z.string().min(1, 'Canal inválido').optional(),
    forma_pagamento: z.enum(['a_vista', 'prazo'], { error: 'Forma de pagamento inválida' }).optional(),
    dias_prazo: z.coerce.number({ error: 'Prazo em dias deve ser maior que zero' }).int().positive('Prazo em dias deve ser maior que zero').optional(),
    itens: z.array(
        z.object({
            produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido'),
            quantidade: z.coerce.number({ error: 'Quantidade deve ser maior que zero' }).int().positive('Quantidade deve ser maior que zero')
        }).strict()
    ).min(1, 'A venda deve ter ao menos um item')
}).strict().refine((data) => data.forma_pagamento !== 'prazo' || data.dias_prazo !== undefined, {
    message: 'Informe dias_prazo para vendas a prazo',
    path: ['dias_prazo']
});

module.exports = {
    criarVendaSchema
};
