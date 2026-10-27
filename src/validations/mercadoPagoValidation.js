const { z } = require('zod');

const valorPix = z.number('Valor inválido')
    .refine(Number.isFinite, 'Valor inválido')
    .refine((v) => v >= 0.01 && v <= 999999.99, 'Valor deve estar entre 0,01 e 999.999,99')
    // No máximo 2 casas decimais, sem erro de ponto flutuante.
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Valor deve ter no máximo 2 casas decimais');

const criarPixSchema = z.strictObject({
    valor: valorPix,
    cliente_email: z.string().trim().max(254).email('E-mail do cliente inválido').optional()
});

const codigoCobrancaSchema = z.string().uuid('Código de cobrança inválido');

module.exports = { criarPixSchema, codigoCobrancaSchema };
