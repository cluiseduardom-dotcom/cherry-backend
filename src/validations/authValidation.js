const { z } = require('zod');
const { CARGOS } = require('../constants/cargos');

const loginSchema = z.object({
    email: z.string().email('Email inválido'),
    senha: z.string().min(1, 'Senha é obrigatória')
});

const registerSchema = z.object({
    nome: z.string().min(1, 'Nome é obrigatório'),
    email: z.string().email('Email inválido'),
    senha: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
    papel: z.enum(CARGOS, { message: 'Papel inválido' })
});

const alterarSenhaSchema = z.object({
    senha_atual: z.string().min(1, 'Senha atual é obrigatória').max(128, 'Senha muito longa'),
    nova_senha: z.string().min(8, 'A nova senha deve ter no mínimo 8 caracteres').max(128, 'Senha muito longa')
});

module.exports = {
    loginSchema,
    registerSchema,
    alterarSenhaSchema
};
