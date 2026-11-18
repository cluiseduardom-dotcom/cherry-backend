const { z } = require('zod');
const { TIPOS_IMPORTACAO } = require('../constants/importacaoLista');

const tipoSchema = z.enum(TIPOS_IMPORTACAO, { error: 'Tipo inválido: use produtos ou clientes' });

// Multipart chega como texto: o id do local vem como string.
const previaSchema = z.object({
    tipo: tipoSchema,
    local_padrao_id: z.string().regex(/^[1-9]\d{0,9}$/, 'Local padrão inválido').transform(Number).optional()
}).strict();

const modeloSchema = z.object({
    tipo: tipoSchema,
    formato: z.enum(['csv', 'xlsx'], { error: 'Formato inválido: use csv' }).default('csv')
});

const confirmarSchema = z.object({
    token: z.string({ error: 'Token da prévia é obrigatório' }).regex(/^[A-Za-z0-9_-]{43}$/, 'Token da prévia inválido'),
    somente_validas: z.boolean({ error: 'somente_validas deve ser verdadeiro ou falso' }).default(false)
}).strict();

const idImportacaoSchema = z.string().regex(/^[1-9]\d{0,9}$/, 'ID inválido').transform(Number);

module.exports = { previaSchema, modeloSchema, confirmarSchema, idImportacaoSchema };
