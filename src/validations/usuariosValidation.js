const { z } = require('zod');
const { CARGOS } = require('../constants/cargos');

// Mesmas regras de nome/e-mail/senha de POST /auth/register, para não haver dois padrões.
// `strict`: campo desconhecido (ex.: empresa_id, ativo) é recusado, nunca ignorado.
const criarUsuarioSchema = z.object({
    nome: z.string().trim().min(1, 'Nome é obrigatório').max(255, 'Nome muito longo'),
    email: z.string().trim().email('Email inválido').max(255, 'Email muito longo'),
    senha: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres').max(128, 'Senha muito longa'),
    papel: z.enum(CARGOS, { message: 'Papel inválido' })
}).strict();

const bloqueioSchema = z.object({
    bloqueado: z.boolean({ error: 'Informe se o usuário deve ficar bloqueado' }),
    motivo: z.string({ error: 'Motivo é obrigatório' }).trim().min(3, 'Motivo deve ter ao menos 3 caracteres').max(300, 'Motivo muito longo')
}).strict();

const usuarioIdSchema = z.coerce.number({ error: 'Usuário inválido' }).int('Usuário inválido').positive('Usuário inválido');

module.exports = {
    criarUsuarioSchema,
    bloqueioSchema,
    usuarioIdSchema
};
