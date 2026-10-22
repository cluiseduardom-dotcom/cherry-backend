const { z } = require('zod');
const { CARGOS } = require('../constants/cargos');

// Conceder e revogar exigem a senha de QUEM executa e um motivo (vai para a auditoria).
const confirmacaoSchema = z.object({
    senha: z.string({ message: 'Senha obrigatória' }).min(1, 'Senha obrigatória').max(200, 'Senha inválida'),
    motivo: z.string({ message: 'Motivo obrigatório' }).trim().min(5, 'Informe o motivo (mínimo 5 caracteres)').max(500, 'Motivo muito longo')
}).strict();

const usuarioIdSchema = z.coerce.number({ message: 'Usuário inválido' }).int('Usuário inválido').positive('Usuário inválido');

const cargoSchema = z.enum(CARGOS, { message: 'Cargo inválido' });

const historicoQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    escopo: z.enum(['usuario', 'cargo']).optional(),
    alvo_usuario_id: z.coerce.number().int().positive().optional(),
    alvo_cargo: cargoSchema.optional()
});

module.exports = { confirmacaoSchema, usuarioIdSchema, cargoSchema, historicoQuerySchema };
