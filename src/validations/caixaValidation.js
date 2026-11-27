const { z } = require('zod');

// Dinheiro em reais, com no máximo 2 casas e teto de R$ 999.999,99 (NUMERIC(15,2) comporta; o teto barra erro de digitação).
const dinheiro = (mensagem) => z.number({ error: mensagem })
    .finite(mensagem)
    .min(0, 'O valor não pode ser negativo')
    .max(999999.99, 'O valor máximo é R$ 999.999,99')
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'O valor deve ter no máximo 2 casas decimais');

const CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{8,80}$/;

// Hoje só o dinheiro tem "esperado" calculável (as vendas ainda não se ligam ao caixa; ver PR C). As demais formas
// entram na conferência quando as vendas forem ligadas, sem mudar este contrato.
const FORMAS_CONFERIVEIS = ['dinheiro'];

const caixaCriarSchema = z.object({
    nome: z.string({ error: 'Informe o nome do caixa' }).trim().min(1, 'Informe o nome do caixa').max(60, 'O nome deve ter no máximo 60 caracteres')
}).strict();

const caixaAtualizarSchema = z.object({
    ativo: z.boolean({ error: 'Informe se o caixa está ativo' })
}).strict();

const abrirSessaoSchema = z.object({
    caixa_id: z.number({ error: 'Informe o caixa' }).int('Caixa inválido').positive('Caixa inválido'),
    saldo_inicial: dinheiro('Informe o saldo inicial (troco)')
}).strict();

const movimentoSchema = z.object({
    tipo: z.enum(['suprimento', 'sangria'], { error: 'Tipo inválido: use suprimento ou sangria' }),
    valor: dinheiro('Informe o valor').refine((v) => v > 0, 'O valor deve ser maior que zero'),
    motivo: z.string({ error: 'Informe o motivo' }).trim().min(3, 'Informe o motivo (mínimo 3 caracteres)').max(300, 'O motivo deve ter no máximo 300 caracteres')
}).strict();

const fechamentoSchema = z.object({
    conferencia: z.array(z.object({
        forma: z.enum(FORMAS_CONFERIVEIS, { error: `Forma não conferível: use ${FORMAS_CONFERIVEIS.join(', ')}` }),
        informado: dinheiro('Informe o valor contado')
    }).strict()).min(1, 'Informe a conferência do caixa').max(FORMAS_CONFERIVEIS.length, 'Conferência com formas repetidas')
        .refine((itens) => new Set(itens.map((i) => i.forma)).size === itens.length, 'Conferência com formas repetidas'),
    justificativa: z.string().trim().max(500, 'A justificativa deve ter no máximo 500 caracteres').optional()
}).strict();

const paginacao = {
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
};

const sessoesQuerySchema = z.object({
    status: z.enum(['aberta', 'fechada']).optional(),
    caixa_id: z.coerce.number().int().positive().optional(),
    ...paginacao
});

module.exports = {
    CHAVE_IDEMPOTENCIA, FORMAS_CONFERIVEIS, caixaCriarSchema, caixaAtualizarSchema, abrirSessaoSchema, movimentoSchema, fechamentoSchema, sessoesQuerySchema
};
