const { z } = require('zod');

const CATEGORIAS = ['estrutural', 'pessoal', 'administrativa'];

const criarDespesaFixaSchema = z.object({
    categoria: z.enum(CATEGORIAS, { error: 'Categoria inválida' }),
    descricao: z.string({ error: 'Descrição é obrigatória' }).min(1, 'Descrição é obrigatória'),
    valor: z.coerce.number({ error: 'Valor é obrigatório' }).min(0, 'Valor não pode ser negativo')
}).strict();

const atualizarDespesaFixaSchema = z.object({
    categoria: z.enum(CATEGORIAS, { error: 'Categoria inválida' }).optional(),
    descricao: z.string().min(1, 'Descrição é obrigatória').optional(),
    valor: z.coerce.number().min(0, 'Valor não pode ser negativo').optional()
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'Informe ao menos um campo para atualizar' });

module.exports = {
    criarDespesaFixaSchema,
    atualizarDespesaFixaSchema
};
