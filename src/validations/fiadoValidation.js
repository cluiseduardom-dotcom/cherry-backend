const { z } = require('zod');

// Valor em reais, positivo, com no máximo 2 casas e teto de R$ 999.999,99 (NUMERIC(12,2) comporta; o teto barra erro de digitação).
const valor = z.number({ error: 'Informe o valor' })
    .finite('Informe o valor')
    .positive('O valor deve ser maior que zero')
    .max(999999.99, 'O valor máximo por lançamento é R$ 999.999,99')
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'O valor deve ter no máximo 2 casas decimais');

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD').refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);

    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Data inválida');

const compraSchema = z.object({
    valor,
    descricao: z.string({ error: 'Descreva a compra' }).trim().min(1, 'Descreva a compra').max(200, 'A descrição deve ter no máximo 200 caracteres'),
    data: dataIso.optional()
}).strict();

const pagamentoSchema = z.object({
    valor,
    forma: z.enum(['dinheiro', 'pix', 'debito', 'credito', 'outro'], { error: 'Forma de pagamento inválida' }).optional(),
    data: dataIso.optional()
}).strict();

const estornoSchema = z.object({
    motivo: z.string({ error: 'Informe o motivo do estorno' }).trim().min(3, 'Informe o motivo do estorno (mínimo 3 caracteres)').max(300, 'O motivo deve ter no máximo 300 caracteres')
}).strict();

const paginacao = {
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
};

const clientesQuerySchema = z.object({
    busca: z.string().trim().max(60).optional(),
    com_saldo: z.enum(['true', 'false']).optional(),
    ...paginacao
});

const extratoQuerySchema = z.object({ ...paginacao });

const resumoQuerySchema = z.object({ de: dataIso.optional(), ate: dataIso.optional() }).refine((q) => !q.de || !q.ate || q.de <= q.ate, 'A data inicial não pode ser depois da final');

const CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{8,80}$/;

module.exports = { compraSchema, pagamentoSchema, estornoSchema, clientesQuerySchema, extratoQuerySchema, resumoQuerySchema, CHAVE_IDEMPOTENCIA };
