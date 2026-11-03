const { z } = require('zod');
const { CARGOS } = require('../constants/cargos');

const { SLUG_REGEX } = require('../constants/temasVisuais');

// Entrar com e-mail (em qualquer tela) ou com o código de usuário (ex.: EGASIL), que é único por empresa e
// por isso exige a loja (`empresa_slug`, da página /c/<slug>). `email` continua aceito (clientes antigos).
const loginSchema = z.object({
    identificador: z.string().trim().min(1, 'Informe o e-mail ou o usuário').max(254, 'Usuário inválido').optional(),
    email: z.string().trim().min(1, 'Informe o e-mail ou o usuário').max(254, 'Usuário inválido').optional(),
    empresa_slug: z.string().trim().toLowerCase().regex(SLUG_REGEX, 'Loja inválida').optional(),
    senha: z.string({ error: 'Senha é obrigatória' }).min(1, 'Senha é obrigatória')
}).refine((d) => Boolean(d.identificador || d.email), { message: 'Informe o e-mail ou o usuário' })
    .transform(({ identificador, email, ...resto }) => ({ ...resto, identificador: identificador ?? email }));

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
