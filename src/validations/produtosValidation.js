const { z } = require('zod');

const criarProdutoSchema = z.object({
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório'),
    preco_venda: z.coerce.number({ error: 'Preço de venda é obrigatório' }).positive('Preço de venda é obrigatório'),
    custo: z.coerce.number({ error: 'Custo é obrigatório' }).positive('Custo é obrigatório')
});

const ajustarPrecoSchema = z.object({
    id: z.coerce.number({ error: 'ID inválido' }).int().positive('ID inválido'),
    percentual: z.coerce.number({ error: 'Percentual fora do limite' }).min(-0.5, 'Percentual fora do limite').max(1, 'Percentual fora do limite')
});

module.exports = {
    criarProdutoSchema,
    ajustarPrecoSchema
};
