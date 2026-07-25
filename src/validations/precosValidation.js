const { z } = require('zod');

// margem_percentual nunca é aceita do cliente: é sempre calculada no backend
// a partir do custo do produto. O corpo aceita markup_percentual OU preco_venda,
// nunca os dois.
const definirPrecoSchema = z.object({
    markup_percentual: z.coerce.number({ error: 'Markup inválido' }).optional(),
    preco_venda: z.coerce.number({ error: 'Preço de venda inválido' }).positive('Preço de venda deve ser maior que zero').optional()
}).strict().refine(
    (data) => (data.markup_percentual !== undefined) !== (data.preco_venda !== undefined),
    { message: 'Informe markup_percentual ou preco_venda, não os dois' }
);

module.exports = {
    definirPrecoSchema
};
