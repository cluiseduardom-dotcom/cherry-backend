const { z } = require('zod');

const onboardingSchema = z.object({
    empresa_nome: z.string().trim().min(2, 'Nome da empresa deve ter no mínimo 2 caracteres').max(255, 'Nome da empresa muito longo'),
    cnpj: z.string().trim().min(11, 'CNPJ/CPF inválido').max(20, 'CNPJ/CPF inválido').optional(),
    nome_admin: z.string().trim().min(2, 'Nome do administrador deve ter no mínimo 2 caracteres').max(255, 'Nome do administrador muito longo'),
    email_admin: z.string().trim().toLowerCase().email('Email do administrador inválido'),
    senha_admin: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres').max(72, 'Senha muito longa')
});

module.exports = { onboardingSchema };
