const { z } = require('zod');
const { MOTIVOS_ESTOQUE } = require('../constants/motivosEstoque');

const OBSERVACAO_MINIMA = 3;

// Movimentação avulsa: o motivo é um código de lista fechada (por tipo), nunca texto livre sozinho.
// `observacao` complementa e é obrigatória nos motivos que dependem de explicação.
const registrarMovimentacaoSchema = z.object({
    tipo: z.enum(['entrada', 'saida', 'ajuste'], { message: 'Tipo inválido' }),
    quantidade: z.coerce.number({ error: 'Quantidade é obrigatória' })
        .int('Quantidade deve ser um número inteiro')
        .nonnegative('Quantidade não pode ser negativa'),
    motivo_codigo: z.string({ error: 'Motivo é obrigatório' }),
    observacao: z.string().trim().max(200, 'Observação deve ter no máximo 200 caracteres').optional(),
    local_id: z.coerce.number({ error: 'Local inválido' }).int('Local inválido').positive('Local inválido').optional()
}).refine(
    (data) => data.tipo === 'ajuste' || data.quantidade > 0,
    { message: 'Quantidade deve ser maior que zero', path: ['quantidade'] }
).superRefine((data, ctx) => {
    const motivo = MOTIVOS_ESTOQUE[data.tipo]?.[data.motivo_codigo];

    if (!motivo) {
        ctx.addIssue({ code: 'custom', message: 'Motivo inválido para este tipo de movimentação', path: ['motivo_codigo'] });
        return;
    }

    if (motivo.observacao_obrigatoria && (data.observacao ?? '').length < OBSERVACAO_MINIMA) {
        ctx.addIssue({ code: 'custom', message: `Informe a observação (mínimo ${OBSERVACAO_MINIMA} caracteres) para este motivo`, path: ['observacao'] });
    }
});

module.exports = {
    registrarMovimentacaoSchema
};
