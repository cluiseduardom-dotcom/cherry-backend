const { z } = require('zod');

// preco_unitario nunca é aceito do cliente: o preço de cada item é sempre o
// preço vigente do produto no canal informado (módulo de precificação),
// travado no momento da criação da venda.
const criarVendaSchema = z.object({
    cliente_id: z.coerce.number({ error: 'Cliente inválido' }).int().positive('Cliente inválido').optional(),
    canal: z.string().min(1, 'Canal inválido').optional(),
    itens: z.array(
        z.object({
            produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido'),
            quantidade: z.coerce.number({ error: 'Quantidade deve ser maior que zero' }).int().positive('Quantidade deve ser maior que zero')
        }).strict()
    ).min(1, 'A venda deve ter ao menos um item')
}).strict();

module.exports = {
    criarVendaSchema
};
