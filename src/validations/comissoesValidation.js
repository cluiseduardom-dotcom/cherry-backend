const { z } = require('zod');

// Strings 'YYYY-MM-DD' do início ao fim (nunca viram Date): mesma armadilha de
// fuso horário das demais colunas DATE do projeto.
const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const periodoSchema = z.object({
    data_inicio: dataISO('Data inicial inválida').optional(),
    data_fim: dataISO('Data final inválida').optional()
}).refine((data) => !data.data_inicio || !data.data_fim || data.data_inicio <= data.data_fim, {
    message: 'Data inicial não pode ser depois da data final',
    path: ['data_fim']
});

// usuario_id ausente/null = padrão da empresa. percentual null = remover a regra
// (o vendedor volta a herdar o padrão). Percentual com até 4 casas, de 0 a 100.
const definirPercentualSchema = z.object({
    usuario_id: z.number({ error: 'Usuário inválido' }).int('Usuário inválido').positive('Usuário inválido').nullable().optional(),
    percentual: z.number({ error: 'Percentual inválido' })
        .min(0, 'Percentual deve estar entre 0 e 100')
        .max(100, 'Percentual deve estar entre 0 e 100')
        .refine((valor) => Math.abs(valor * 10000 - Math.round(valor * 10000)) < 1e-6, 'Percentual aceita até 4 casas decimais')
        .nullable()
}).strict();

const idSchema = z.coerce.number({ error: 'Identificador inválido' }).int('Identificador inválido').positive('Identificador inválido');

const repassesQuerySchema = z.object({
    status: z.enum(['a_repassar', 'confirmado', 'cancelado'], { error: 'Status inválido' }).optional()
});

const confirmarRepasseSchema = z.object({
    observacao: z.string().trim().max(300, 'Observação muito longa').optional()
}).strict();

const FORMAS_PAGAMENTO_COMISSAO = ['pix', 'transferencia', 'dinheiro', 'outro'];

// valor_esperado = o líquido a pagar que a tela mostrou; o backend recusa (409) se mudou.
// pago_em: AAAA-MM-DD, não pode ser futuro (tolerância de 1 dia pelo fuso).
const registrarPagamentoComissaoSchema = z.object({
    vendedor_id: z.number({ error: 'Vendedor inválido' }).int('Vendedor inválido').positive('Vendedor inválido'),
    valor_esperado: z.number({ error: 'Valor inválido' })
        .positive('Valor deve ser maior que zero')
        .max(1000000000, 'Valor muito alto')
        .refine((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6, 'Valor aceita até 2 casas decimais'),
    forma: z.enum(FORMAS_PAGAMENTO_COMISSAO, { error: 'Forma de pagamento inválida' }),
    pago_em: dataISO('Data do pagamento inválida'),
    observacao: z.string().trim().max(300, 'Observação muito longa').optional()
}).strict().refine((dados) => dados.pago_em <= new Date(Date.now() + 86400000).toISOString().slice(0, 10), {
    message: 'Data do pagamento não pode ser futura',
    path: ['pago_em']
});

// Quando a empresa paga a comissão: assim que liberada, ou só de vendas de meses já fechados.
const definirModoPagamentoSchema = z.object({
    modo_pagamento: z.enum(['liberada', 'fim_do_mes'], { error: 'Modo de pagamento inválido' })
}).strict();

const pagamentosQuerySchema = z.object({
    vendedor_id: idSchema.optional()
});

module.exports = {
    FORMAS_PAGAMENTO_COMISSAO,
    registrarPagamentoComissaoSchema,
    pagamentosQuerySchema,
    definirModoPagamentoSchema,
    periodoSchema,
    definirPercentualSchema,
    idSchema,
    repassesQuerySchema,
    confirmarRepasseSchema
};
