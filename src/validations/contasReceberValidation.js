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

// Recebimento (total ou parcial). Sem `valor`, recebe o restante (calculado pelo servidor). Corpo estrito: empresa, conta,
// parcela e status nunca vêm do cliente.
const receberContaSchema = z.object({
    valor: z.number({ error: 'Valor do recebimento inválido' })
        .finite('Valor do recebimento inválido')
        .positive('O valor do recebimento deve ser maior que zero')
        .max(999999999.99, 'Valor do recebimento inválido')
        .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'O valor deve ter no máximo 2 casas decimais')
        .optional(),
    forma_pagamento: z.enum(['dinheiro', 'pix', 'debito', 'credito'], { error: 'Forma de pagamento inválida' }).default('dinheiro'),
    observacao: z.string().trim().max(300, 'A observação deve ter no máximo 300 caracteres').transform((v) => v || null).nullable().optional()
}).strict();

const CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{8,80}$/;

module.exports = {
    listarContasReceberSchema,
    receberContaSchema,
    CHAVE_IDEMPOTENCIA
};
