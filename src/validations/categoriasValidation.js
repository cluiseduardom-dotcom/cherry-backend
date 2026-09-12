const { z } = require('zod');

const criarCategoriaSchema = z.object({
    nivel: z.coerce.number({ error: 'Nível é obrigatório' }).int('Nível inválido').positive('Nível inválido'),
    codigo: z.string({ error: 'Código é obrigatório' }).min(1, 'Código é obrigatório').max(3, 'Código deve ter no máximo 3 caracteres').regex(/^[A-Za-z0-9]+$/, 'Código deve conter apenas letras e números'),
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório')
}).strict();

const atualizarCategoriaSchema = z.object({
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório')
}).strict();

module.exports = { criarCategoriaSchema, atualizarCategoriaSchema };
