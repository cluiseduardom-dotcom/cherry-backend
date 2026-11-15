const { z } = require('zod');
const { ORIGENS_AQUISICAO, PARCEIRO_CODIGO_REGEX } = require('../constants/origensAquisicao');

const onboardingSchema = z.object({
    empresa_nome: z.string().trim().min(2, 'Nome da empresa deve ter no mínimo 2 caracteres').max(255, 'Nome da empresa muito longo'),
    cnpj: z.string().trim().min(11, 'CNPJ/CPF inválido').max(20, 'CNPJ/CPF inválido').optional(),
    nome_admin: z.string().trim().min(2, 'Nome do administrador deve ter no mínimo 2 caracteres').max(255, 'Nome do administrador muito longo'),
    email_admin: z.string().trim().toLowerCase().email('Email do administrador inválido'),
    senha_admin: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres').max(72, 'Senha muito longa'),
    origem_aquisicao: z.enum(ORIGENS_AQUISICAO, { error: 'Origem de aquisição inválida' }).optional(),
    parceiro_codigo: z.string()
        .trim()
        .toUpperCase()
        .regex(PARCEIRO_CODIGO_REGEX, 'Código do parceiro inválido (2 a 40 caracteres: letras, números, hífen ou sublinhado)')
        .optional()
}).superRefine((dados, ctx) => {
    const indicacao = dados.origem_aquisicao === 'indicacao_parceiro';

    if (indicacao && dados.parceiro_codigo === undefined) {
        ctx.addIssue({
            code: 'custom',
            path: ['parceiro_codigo'],
            message: 'Informe o código do parceiro para origem por indicação'
        });
    }

    if (!indicacao && dados.parceiro_codigo !== undefined) {
        ctx.addIssue({
            code: 'custom',
            path: ['parceiro_codigo'],
            message: 'Código do parceiro só é aceito quando a origem é indicação de parceiro'
        });
    }
});

module.exports = { onboardingSchema };
