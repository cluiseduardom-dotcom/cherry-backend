const { z } = require('zod');

// Strings 'YYYY-MM-DD' do início ao fim (z.iso.date), nunca viram Date: mesma
// armadilha de fuso horário já documentada em contas a pagar/receber — o
// driver pg serializaria um Date usando os getters LOCAIS do processo, não
// UTC, e desalinharia a data gravada/comparada em qualquer servidor com
// fuso negativo.
const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const periodoPontoEquilibrioSchema = z.object({
    data_inicio: dataISO('Data inicial inválida').optional(),
    data_fim: dataISO('Data final inválida').optional()
}).refine((data) => !data.data_inicio || !data.data_fim || data.data_inicio <= data.data_fim, {
    message: 'Data inicial não pode ser depois da data final'
});

module.exports = {
    periodoPontoEquilibrioSchema
};
