const { z } = require('zod');

const idPositivo = (rotulo) => z.coerce.number({ error: `${rotulo} inválido` }).int(`${rotulo} inválido`).positive(`${rotulo} inválido`);

const criarConferenciaSchema = z.object({
    itens: z.array(z.object({
        produto_id: idPositivo('Produto'),
        quantidade_contada: z.coerce.number({ error: 'Quantidade contada é obrigatória' })
            .int('Quantidade contada deve ser inteira')
            .min(0, 'Quantidade contada não pode ser negativa')
            .max(1000000, 'Quantidade contada muito alta')
    }).strict(), { error: 'Informe os itens contados' })
        .min(1, 'Informe ao menos um item')
        .max(200, 'Máximo de 200 itens por conferência'),
    observacao: z.string().trim().max(500, 'Observação muito longa').optional(),
    // Só o admin pode pedir; a conferência sozinha nunca altera estoque.
    aplicar_ajuste: z.boolean({ error: 'aplicar_ajuste deve ser verdadeiro ou falso' }).optional().default(false)
}).strict().refine((d) => new Set(d.itens.map((i) => i.produto_id)).size === d.itens.length, { message: 'Produto repetido nos itens', path: ['itens'] });

const acertoQuerySchema = z.object({
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)')
        .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Data inválida (use AAAA-MM-DD)')
        .optional()
}).strict();

const saldosQuerySchema = z.object({
    busca: z.string().trim().max(100, 'Busca muito longa').optional()
}).strict();

module.exports = { criarConferenciaSchema, acertoQuerySchema, saldosQuerySchema };
