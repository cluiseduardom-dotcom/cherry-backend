const { z } = require('zod');

// Ficha de venda pode ser vazia: "este SKU não leva embalagem nem brinde" é uma ficha válida (e é como se limpa).
const criarFichaVendaSchema = z.object({
    itens: z.array(
        z.object({
            insumo_produto_id: z.coerce.number({ error: 'Insumo inválido' }).int('Insumo inválido').positive('Insumo inválido'),
            quantidade: z.coerce.number({ error: 'Quantidade deve ser um inteiro maior que zero' })
                .int('Quantidade deve ser um inteiro maior que zero')
                .positive('Quantidade deve ser um inteiro maior que zero')
                .max(1000, 'Quantidade por unidade vendida acima do limite (1000)')
        }).strict()
    ).max(50, 'A ficha de venda aceita no máximo 50 itens')
}).strict().refine(
    (data) => new Set(data.itens.map((item) => item.insumo_produto_id)).size === data.itens.length,
    { message: 'Insumo repetido na ficha de venda', path: ['itens'] }
);

module.exports = { criarFichaVendaSchema };
