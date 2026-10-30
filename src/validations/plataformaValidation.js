const { z } = require('zod');

// mes = YYYY-MM (mês civil no fuso de Brasília). Sem mes: mês corrente.
const taxasPorEmpresaQuerySchema = z.strictObject({
    mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mes deve estar no formato AAAA-MM').optional()
});

// Data civil AAAA-MM-DD existente (rejeita 2026-02-30).
const dataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD').refine((valor) => {
    const [ano, mes, dia] = valor.split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}, 'Data inválida');

const justificativa = z.string({ error: 'Justificativa é obrigatória' }).trim().min(3, 'Justificativa é obrigatória').max(500, 'Justificativa muito longa');

const empresaIdParamSchema = z.strictObject({
    id: z.coerce.number().int().positive('Empresa inválida')
});

const trocarPlanoSchema = z.strictObject({
    plano: z.string({ error: 'Plano é obrigatório' }).trim().min(1, 'Plano é obrigatório').max(40),
    vigencia_inicio: dataCivil.optional(),
    justificativa
});

// Percentual em pontos percentuais (0,5 = 0,50%), até 4 casas, como NUMERIC(7,4).
const percentual = z.number({ error: 'Percentual é obrigatório' })
    .min(0, 'Percentual deve estar entre 0 e 100')
    .max(100, 'Percentual deve estar entre 0 e 100')
    .refine((valor) => Math.abs(valor * 10000 - Math.round(valor * 10000)) < 1e-6, 'Percentual aceita no máximo 4 casas decimais');

const definirCondicaoSchema = z.strictObject({
    percentual,
    vigencia_inicio: dataCivil.optional(),
    vigencia_fim: dataCivil.optional(),
    justificativa
});

const encerrarCondicaoSchema = z.strictObject({
    a_partir_de: dataCivil.optional(),
    justificativa
});

module.exports = {
    taxasPorEmpresaQuerySchema,
    empresaIdParamSchema,
    trocarPlanoSchema,
    definirCondicaoSchema,
    encerrarCondicaoSchema
};
