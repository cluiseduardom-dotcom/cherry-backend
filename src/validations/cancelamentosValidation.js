const { z } = require('zod');
const { CODIGOS_FAIXA } = require('../constants/cancelamento');

// Corpo do cancelamento: motivo é obrigatório em TODAS as faixas. `autorizacao` (e-mail e senha de
// quem autoriza, digitados na hora) só é usada quando a faixa da venda a exige.
const cancelarVendaSchema = z.object({
    motivo: z.string({ message: 'Motivo obrigatório' }).trim().min(5, 'Informe o motivo (mínimo 5 caracteres)').max(500, 'Motivo muito longo'),
    autorizacao: z.object({
        email: z.string({ message: 'E-mail do autorizador obrigatório' }).trim().min(1, 'E-mail do autorizador obrigatório').max(255, 'E-mail inválido'),
        senha: z.string({ message: 'Senha do autorizador obrigatória' }).min(1, 'Senha do autorizador obrigatória').max(200, 'Senha inválida')
    }).strict().optional()
}).strict();

const idPositivo = z.coerce.number().int().positive();

const listarCancelamentosQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    data_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data_de inválida (use AAAA-MM-DD)').optional(),
    data_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data_ate inválida (use AAAA-MM-DD)').optional(),
    cancelado_por: idPositivo.optional(),
    autorizado_por: idPositivo.optional(),
    venda_id: idPositivo.optional(),
    faixa: z.enum(CODIGOS_FAIXA, { message: 'Faixa inválida' }).optional()
}).refine((q) => !(q.data_de && q.data_ate) || q.data_de <= q.data_ate, { message: 'data_de maior que data_ate' });

module.exports = { cancelarVendaSchema, listarCancelamentosQuerySchema };
