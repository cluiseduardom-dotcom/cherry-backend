const { z } = require('zod');
const { diasEntre } = require('../utils/relatorios');

const dataISO = (mensagem) => z.iso.date({ error: mensagem });
const MAX_DIAS_PERIODO = 731;

const periodoBase = {
    data_de: dataISO('Data inicial inválida'),
    data_ate: dataISO('Data final inválida')
};

function validarPeriodo(data, ctx) {
    if (data.data_de > data.data_ate) {
        ctx.addIssue({ code: 'custom', message: 'Data inicial não pode ser depois da data final', path: ['data_ate'] });
        return;
    }

    if (diasEntre(data.data_de, data.data_ate) > MAX_DIAS_PERIODO) {
        ctx.addIssue({ code: 'custom', message: `Período máximo de ${MAX_DIAS_PERIODO} dias`, path: ['data_ate'] });
    }
}

const periodoSchema = z.object(periodoBase).superRefine(validarPeriodo);

const produtosSchema = z.object({
    ...periodoBase,
    ordem: z.enum(['receita', 'quantidade', 'margem'], { error: 'Ordem inválida (use receita, quantidade ou margem)' }).default('receita'),
    limite: z.coerce.number({ error: 'Limite inválido' }).int('Limite inválido').min(1, 'Limite inválido').max(200, 'Limite máximo de 200').default(50)
}).superRefine(validarPeriodo);

const booleanoQuery = z.enum(['true', 'false'], { error: 'Valor inválido (use true ou false)' }).transform((v) => v === 'true');

const inventarioSchema = z.object({
    local_id: z.coerce.number({ error: 'Local inválido' }).int('Local inválido').positive('Local inválido').optional(),
    tipo: z.enum(['produto', 'insumo'], { error: 'Tipo inválido (use produto ou insumo)' }).default('produto'),
    somente_com_saldo: booleanoQuery.default(true),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const creditoSchema = z.object({
    data_ref: dataISO('Data de referência inválida').optional()
});

module.exports = { periodoSchema, produtosSchema, inventarioSchema, creditoSchema };
