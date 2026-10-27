const { z } = require('zod');

// mes = YYYY-MM (mês civil no fuso de Brasília). Sem mes: mês corrente.
const taxasPorEmpresaQuerySchema = z.strictObject({
    mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mes deve estar no formato AAAA-MM').optional()
});

module.exports = { taxasPorEmpresaQuerySchema };
