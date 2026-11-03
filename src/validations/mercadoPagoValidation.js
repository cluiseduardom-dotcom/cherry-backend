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

// `parcelas_maximas` (opcional): teto de parcelas escolhido na venda. Nunca passa do teto global da plataforma
// (MP_LINK_PARCELAS_MAXIMAS): o serviço usa o menor dos dois.
const criarLinkCartaoSchema = z.strictObject({
    valor: valorPix,
    parcelas_maximas: z.number('Parcelas máximas inválidas').int('Parcelas máximas inválidas').min(1, 'Parcelas máximas deve ser de 1 a 24').max(24, 'Parcelas máximas deve ser de 1 a 24').optional()
});

const codigoCobrancaSchema = z.string().uuid('Código de cobrança inválido');

const devolucaoSchema = z.strictObject({
    motivo: z.string('Informe o motivo da devolução').trim().min(3, 'Informe o motivo da devolução').max(200, 'O motivo deve ter no máximo 200 caracteres')
});

const paginacaoDevolucoesSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
});

module.exports = { criarPixSchema, criarLinkCartaoSchema, codigoCobrancaSchema, devolucaoSchema, paginacaoDevolucoesSchema };
