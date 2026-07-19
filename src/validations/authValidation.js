const { z } = require('zod');

const loginSchema = z.object({
    email: z.string().email('Email inválido'),
    senha: z.string().min(1, 'Senha é obrigatória')
});

module.exports = {
    loginSchema
};
