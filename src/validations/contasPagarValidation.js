const { z } = require('zod');

// data_vencimento/vencimento_de/vencimento_ate ficam como string 'YYYY-MM-DD'
// (z.iso.date), nunca viram objeto Date: o driver pg serializa um Date para
// uma coluna DATE usando os métodos de fuso horário LOCAL do processo Node
// (getFullYear/getMonth/getDate), não UTC. Como z.coerce.date('2026-08-10')
// produz meia-noite UTC, em qualquer servidor com fuso negativo (ex: America/
// Sao_Paulo, UTC-3) isso vira 2026-08-09 21h local e grava um dia a menos no
// banco. Mantendo a string como veio, o Postgres interpreta a data sem
// nenhuma conversão de fuso.
const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const criarContaPagarSchema = z.object({
    descricao: z.string({ error: 'Descrição é obrigatória' }).min(1, 'Descrição é obrigatória'),
    fornecedor: z.string().optional(),
    valor: z.coerce.number({ error: 'Valor é obrigatório' }).positive('Valor deve ser maior que zero'),
    data_vencimento: dataISO('Data de vencimento inválida'),
    categoria: z.string().optional(),
    observacao: z.string().optional()
}).strict();

const atualizarContaPagarSchema = z.object({
    descricao: z.string().min(1, 'Descrição é obrigatória').optional(),
    fornecedor: z.string().optional(),
    valor: z.coerce.number().positive('Valor deve ser maior que zero').optional(),
    data_vencimento: dataISO('Data de vencimento inválida').optional(),
    categoria: z.string().optional(),
    observacao: z.string().optional()
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'Informe ao menos um campo para atualizar' });

const listarContasPagarSchema = z.object({
    status: z.enum(['pendente', 'pago', 'cancelado'], { error: 'Status inválido' }).optional(),
    vencimento_de: dataISO('Data inicial de vencimento inválida').optional(),
    vencimento_ate: dataISO('Data final de vencimento inválida').optional()
});

module.exports = {
    criarContaPagarSchema,
    atualizarContaPagarSchema,
    listarContasPagarSchema
};
