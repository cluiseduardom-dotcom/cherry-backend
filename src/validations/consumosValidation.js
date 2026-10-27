const { z } = require('zod');

const inteiroPositivo = (mensagem) => z.coerce.number({ error: mensagem }).int(mensagem).positive(mensagem);
const quantidade = z.coerce.number({ error: 'Quantidade deve ser um inteiro maior que zero' })
    .int('Quantidade deve ser um inteiro maior que zero')
    .positive('Quantidade deve ser um inteiro maior que zero')
    .max(100000, 'Quantidade acima do limite (100000)');
const textoOpcional = (max) => z.string().trim().max(max, `Texto acima de ${max} caracteres`).optional();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD');

const MOTIVOS_AVULSO = ['uso_interno', 'perda', 'brinde', 'outro'];
const MOTIVOS_VENDA = ['brinde', 'substituicao', 'outro'];
const MOTIVOS_RELATORIO = ['consumo_venda', 'substituicao', 'uso_interno', 'perda', 'brinde', 'outro'];

// Consumo avulso: saída de insumo do Central sem venda. "uso_interno" exige a finalidade (para quê).
const consumoAvulsoSchema = z.object({
    produto_id: inteiroPositivo('Insumo inválido'),
    quantidade,
    motivo: z.enum(MOTIVOS_AVULSO, { error: 'Motivo inválido' }),
    responsavel_id: inteiroPositivo('Responsável inválido').optional(),
    finalidade: textoOpcional(200),
    observacao: textoOpcional(500)
}).strict().refine(
    (d) => d.motivo !== 'uso_interno' || (d.finalidade && d.finalidade.length > 0),
    { message: 'Informe para que o item foi retirado (finalidade)', path: ['finalidade'] }
);

// Acrescentar um insumo ao consumo de uma venda já feita (ex.: caneta de brinde, embalagem substituta).
const acrescentarNaVendaSchema = z.object({
    produto_id: inteiroPositivo('Insumo inválido'),
    quantidade,
    motivo: z.enum(MOTIVOS_VENDA, { error: 'Motivo inválido' }),
    observacao: textoOpcional(500)
}).strict();

const substituicaoSchema = z.object({
    de_insumo_id: inteiroPositivo('Insumo atual inválido'),
    para_insumo_id: inteiroPositivo('Insumo substituto inválido')
}).strict().refine((d) => d.de_insumo_id !== d.para_insumo_id, {
    message: 'O insumo substituto deve ser diferente do atual',
    path: ['para_insumo_id']
});

const previaSubstituicaoQuerySchema = z.object({
    de_insumo_id: inteiroPositivo('Insumo atual inválido')
});

const filtrosPeriodoQuerySchema = z.object({
    de: dataIso.optional(),
    ate: dataIso.optional(),
    produto_id: inteiroPositivo('Insumo inválido').optional(),
    motivo: z.enum(MOTIVOS_RELATORIO, { error: 'Motivo inválido' }).optional()
}).refine((d) => !d.de || !d.ate || d.de <= d.ate, { message: 'Data inicial maior que a final', path: ['de'] });

module.exports = {
    MOTIVOS_AVULSO,
    MOTIVOS_VENDA,
    consumoAvulsoSchema,
    acrescentarNaVendaSchema,
    substituicaoSchema,
    previaSubstituicaoQuerySchema,
    filtrosPeriodoQuerySchema
};
