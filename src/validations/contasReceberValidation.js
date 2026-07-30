const { z } = require('zod');

// Mesma armadilha de fuso horário documentada em contasPagarValidation.js:
// datas ficam como string 'YYYY-MM-DD' (z.iso.date), nunca viram Date.
const dataISO = (mensagem) => z.iso.date({ error: mensagem });

// Não existe schema de criação/edição aqui: contas_receber não tem POST/PUT
// próprio — toda linha nasce de POST /vendas (venda a prazo) e só admite
// leitura + marcar como recebida.
const listarContasReceberSchema = z.object({
    status: z.enum(['pendente', 'recebido', 'cancelado'], { error: 'Status inválido' }).optional(),
    vencimento_de: dataISO('Data inicial de vencimento inválida').optional(),
    vencimento_ate: dataISO('Data final de vencimento inválida').optional()
});

module.exports = {
    listarContasReceberSchema
};
