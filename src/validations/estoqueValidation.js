const { z } = require('zod');

const registrarMovimentacaoSchema = z.object({
    tipo: z.enum(['entrada', 'saida', 'ajuste'], { message: 'Tipo inválido' }),
    quantidade: z.coerce.number({ error: 'Quantidade é obrigatória' })
        .int('Quantidade deve ser um número inteiro')
        .nonnegative('Quantidade não pode ser negativa'),
    motivo: z.string().optional()
}).refine(
    (data) => data.tipo === 'ajuste' || data.quantidade > 0,
    { message: 'Quantidade deve ser maior que zero', path: ['quantidade'] }
);

module.exports = {
    registrarMovimentacaoSchema
};
