const { z } = require('zod');

const criarVendaSchema = z.object({
    cliente_id: z.coerce.number({ error: 'Cliente inválido' }).int().positive('Cliente inválido'),
    itens: z.array(
        z.object({
            produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido'),
            quantidade: z.coerce.number({ error: 'Quantidade deve ser maior que zero' }).int().positive('Quantidade deve ser maior que zero'),
            preco_unitario: z.coerce.number({ error: 'Preço unitário deve ser maior que zero' }).positive('Preço unitário deve ser maior que zero')
        })
    ).min(1, 'A venda deve ter ao menos um item')
});

module.exports = {
    criarVendaSchema
};
