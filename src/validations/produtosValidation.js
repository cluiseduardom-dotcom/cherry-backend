const { z } = require('zod');

const criarProdutoSchema = z.object({
    sku: z.string({ error: 'SKU é obrigatório' }).min(1, 'SKU é obrigatório'),
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório'),
    descricao: z.string().optional(),
    categoria: z.string().optional(),
    preco_venda: z.coerce.number({ error: 'Preço de venda é obrigatório' }).positive('Preço de venda é obrigatório'),
    custo: z.coerce.number({ error: 'Custo é obrigatório' }).positive('Custo é obrigatório'),
    estoque_atual: z.coerce.number({ error: 'Estoque atual inválido' }).int('Estoque atual inválido').nonnegative('Estoque atual inválido').optional(),
    estoque_minimo: z.coerce.number({ error: 'Estoque mínimo inválido' }).int('Estoque mínimo inválido').nonnegative('Estoque mínimo inválido').optional(),
    ativo: z.boolean().optional()
});

const atualizarProdutoSchema = z.object({
    sku: z.string().min(1, 'SKU é obrigatório').optional(),
    nome: z.string().min(1, 'Nome é obrigatório').optional(),
    descricao: z.string().optional(),
    categoria: z.string().optional(),
    preco_venda: z.coerce.number().positive('Preço de venda deve ser maior que zero').optional(),
    custo: z.coerce.number().positive('Custo deve ser maior que zero').optional(),
    estoque_atual: z.coerce.number().int('Estoque atual inválido').nonnegative('Estoque atual inválido').optional(),
    estoque_minimo: z.coerce.number().int('Estoque mínimo inválido').nonnegative('Estoque mínimo inválido').optional(),
    ativo: z.boolean().optional()
}).refine((data) => Object.keys(data).length > 0, { message: 'Informe ao menos um campo para atualizar' });

const ajustarPrecoSchema = z.object({
    id: z.coerce.number({ error: 'ID inválido' }).int().positive('ID inválido'),
    percentual: z.coerce.number({ error: 'Percentual fora do limite' }).min(-0.5, 'Percentual fora do limite').max(1, 'Percentual fora do limite')
});

module.exports = {
    criarProdutoSchema,
    atualizarProdutoSchema,
    ajustarPrecoSchema
};
