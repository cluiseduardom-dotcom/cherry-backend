const { z } = require('zod');

const loginSchema = z.object({
    email: z.string().email('Email inválido'),
    senha: z.string().min(1, 'Senha é obrigatória')
});

const registerSchema = z.object({
    nome: z.string().min(1, 'Nome é obrigatório'),
    email: z.string().email('Email inválido'),
    senha: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
    papel: z.enum(['admin', 'vendedor', 'estoquista'], { message: 'Papel inválido' })
});

module.exports = {
    loginSchema,
    registerSchema
};
