const { z } = require('zod');

const criarFichaTecnicaSchema = z.object({
    itens: z.array(
        z.object({
            insumo_produto_id: z.coerce.number({ error: 'Insumo inválido' }).int().positive('Insumo inválido'),
            quantidade_necessaria: z.coerce.number({ error: 'Quantidade necessária deve ser maior que zero' }).int('Quantidade necessária deve ser maior que zero').positive('Quantidade necessária deve ser maior que zero')
        }).strict()
    ).min(1, 'A ficha técnica deve ter ao menos um item')
}).strict().refine(
    (data) => new Set(data.itens.map((item) => item.insumo_produto_id)).size === data.itens.length,
    { message: 'Insumo repetido na ficha técnica', path: ['itens'] }
);

module.exports = { criarFichaTecnicaSchema };
