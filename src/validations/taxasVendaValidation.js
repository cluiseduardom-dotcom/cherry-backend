const { z } = require('zod');

// Strings 'YYYY-MM-DD' do início ao fim (nunca viram Date): mesma armadilha de
// fuso horário das demais colunas DATE do projeto.
const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const listarTaxasVendaSchema = z.object({
    data_inicio: dataISO('Data inicial inválida').optional(),
    data_fim: dataISO('Data final inválida').optional()
}).refine((data) => !data.data_inicio || !data.data_fim || data.data_inicio <= data.data_fim, {
    message: 'Data inicial não pode ser depois da data final',
    path: ['data_fim']
});

module.exports = {
    listarTaxasVendaSchema
};
