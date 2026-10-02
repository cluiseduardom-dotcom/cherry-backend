const { z } = require('zod');

const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const listarMovimentacoesRelatorioSchema = z.object({
    produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido').optional(),
    data_de: dataISO('Data inicial inválida').optional(),
    data_ate: dataISO('Data final inválida').optional()
}).refine((data) => !data.data_de || !data.data_ate || data.data_de <= data.data_ate, {
    message: 'Data inicial não pode ser depois da data final',
    path: ['data_ate']
});

module.exports = { listarMovimentacoesRelatorioSchema };
