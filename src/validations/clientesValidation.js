const { z } = require('zod');

const criarClienteSchema = z.object({
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório'),
    telefone: z.string({ error: 'Telefone inválido' }).optional(),
    email: z.string({ error: 'Email inválido' }).email('Email inválido').optional()
});

module.exports = {
    criarClienteSchema
};
