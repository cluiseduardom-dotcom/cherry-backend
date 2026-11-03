const { z } = require('zod');

// Tudo `strict`: campo desconhecido (empresa_id, origem, provedor, conciliado...) é recusado, nunca ignorado.
// empresa_id e usuário vêm sempre do JWT. Contas criadas pela API são sempre MANUAL: contas integradas
// (Mercado Pago, Open Finance) só o sistema cria.

const TIPOS_CONTA = ['CAIXA', 'CONTA_CORRENTE', 'CONTA_POUPANCA', 'CONTA_PAGAMENTO'];
const STATUS_CONTA = ['ATIVA', 'BLOQUEADA', 'INATIVA'];

const vazioParaNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const textoOpcional = (rotulo, max) => z.preprocess(
    vazioParaNull,
    z.string({ error: `${rotulo} inválido` }).trim().max(max, `${rotulo} muito longo`).nullable().optional()
);

const dinheiro = (rotulo) => z.number({ error: `${rotulo} inválido` })
    .finite(`${rotulo} inválido`)
    .refine((v) => Math.abs(v) < 1e11, `${rotulo} fora do limite`)
    .refine((v) => Math.round(v * 100) / 100 === v, `${rotulo} deve ter no máximo 2 casas decimais`);

const idPositivo = (rotulo) => z.coerce.number({ error: `${rotulo} inválido` }).int(`${rotulo} inválido`).positive(`${rotulo} inválido`);
const data = (rotulo) => z.iso.date({ error: `${rotulo} inválida` }).refine((v) => v >= '1990-01-01', `${rotulo} inválida`);

const camposConta = {
    nome: z.string({ error: 'Nome da conta é obrigatório' }).trim().min(2, 'Nome da conta é obrigatório').max(150, 'Nome muito longo'),
    banco_codigo: textoOpcional('Código do banco', 10),
    instituicao_nome: textoOpcional('Instituição', 150),
    agencia: textoOpcional('Agência', 30),
    conta: textoOpcional('Conta', 50),
    digito: textoOpcional('Dígito', 10),
    saldo_inicial: dinheiro('Saldo inicial'),
    data_saldo_inicial: z.preprocess(vazioParaNull, data('Data do saldo inicial').nullable().optional()),
    observacao: textoOpcional('Observação', 500)
};

const criarContaSchema = z.strictObject({
    ...camposConta,
    tipo: z.enum(TIPOS_CONTA, { error: 'Tipo de conta inválido' }),
    saldo_inicial: camposConta.saldo_inicial.default(0),
    principal: z.boolean({ error: 'Principal inválido' }).optional()
});

const atualizarContaSchema = z.strictObject({
    ...camposConta,
    principal: z.boolean({ error: 'Principal inválido' })
}).partial().refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo para alterar');

const statusContaSchema = z.strictObject({
    status: z.enum(STATUS_CONTA, { error: 'Status da conta inválido' })
});

const criarMovimentoSchema = z.strictObject({
    conta_bancaria_id: idPositivo('Conta bancária'),
    tipo: z.enum(['ENTRADA', 'SAIDA'], { error: 'Tipo de movimento inválido' }),
    valor: dinheiro('Valor').refine((v) => v > 0, 'Valor do movimento inválido'),
    data_movimento: data('Data do movimento'),
    descricao: z.string({ error: 'Descreva o movimento' }).trim().min(3, 'Descreva o movimento').max(255, 'Descrição muito longa'),
    observacao: textoOpcional('Observação', 500)
});

const cancelarMovimentoSchema = z.strictObject({
    motivo: z.string({ error: 'Informe o motivo' }).trim().min(3, 'Informe o motivo (mínimo 3 caracteres)').max(200, 'Motivo muito longo')
});

const booleanoQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

const listarMovimentosSchema = z.strictObject({
    conta_bancaria_id: idPositivo('Conta bancária').optional(),
    tipo: z.enum(['ENTRADA', 'SAIDA']).optional(),
    conciliado: booleanoQuery.optional(),
    incluir_cancelados: booleanoQuery.optional(),
    data_inicio: data('Data inicial').optional(),
    data_fim: data('Data final').optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0)
}).refine((v) => !v.data_inicio || !v.data_fim || v.data_inicio <= v.data_fim, 'Período inválido');

const listarContasSchema = z.strictObject({
    status: z.enum(STATUS_CONTA).optional(),
    tipo: z.enum(TIPOS_CONTA).optional()
});

const conciliarSchema = z.strictObject({
    movimento_bancario_id: idPositivo('Movimento bancário'),
    referencia_externa: textoOpcional('Referência', 255),
    valor_externo: dinheiro('Valor externo').refine((v) => v > 0, 'Valor externo inválido').optional(),
    data_externa: z.iso.datetime({ offset: true, error: 'Data externa inválida' }).optional(),
    descricao_externa: textoOpcional('Descrição externa', 255),
    observacao: textoOpcional('Observação', 500)
});

module.exports = {
    TIPOS_CONTA, criarContaSchema, atualizarContaSchema, statusContaSchema, criarMovimentoSchema,
    cancelarMovimentoSchema, listarMovimentosSchema, listarContasSchema, conciliarSchema, idPositivo
};
