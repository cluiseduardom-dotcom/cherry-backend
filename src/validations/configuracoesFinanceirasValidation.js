const { z } = require('zod');

const atualizarConfiguracaoFinanceiraSchema = z.object({
    aliquota_imposto: z.coerce.number({ error: 'Alíquota de imposto é obrigatória' })
        .min(0, 'Alíquota de imposto deve estar entre 0 e 1')
        .max(1, 'Alíquota de imposto deve estar entre 0 e 1')
}).strict();

module.exports = {
    atualizarConfiguracaoFinanceiraSchema
};
