const { z } = require('zod');

const criarNivelCategoriaSchema = z.object({
    nivel: z.coerce.number({ error: 'Nível é obrigatório' }).int('Nível inválido').positive('Nível inválido'),
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório')
}).strict();

const atualizarNivelCategoriaSchema = z.object({
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório')
}).strict();

module.exports = { criarNivelCategoriaSchema, atualizarNivelCategoriaSchema };
