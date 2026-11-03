const { z } = require('zod');

const loginPainelSchema = z.strictObject({
    email: z.string({ error: 'Informe o e-mail' }).trim().toLowerCase().email('E-mail inválido').max(254),
    senha: z.string({ error: 'Informe a senha' }).min(1, 'Informe a senha').max(200),
    codigo: z.string().trim().regex(/^\d{6}$/, 'O código tem 6 dígitos').optional()
});

const token2faSchema = z.strictObject({
    token_2fa: z.string({ error: 'Sessão de configuração ausente' }).min(10).max(2000),
    codigo: z.string().trim().regex(/^\d{6}$/, 'O código tem 6 dígitos').optional()
});

const trocarSenhaPainelSchema = z.strictObject({
    senha_atual: z.string({ error: 'Informe a senha atual' }).min(1).max(200),
    nova_senha: z.string({ error: 'Informe a nova senha' }).min(12, 'A nova senha deve ter no mínimo 12 caracteres').max(200)
});

const criarEmpresaPainelSchema = z.strictObject({
    empresa_nome: z.string({ error: 'Informe o nome da empresa' }).trim().min(2, 'Nome da empresa muito curto').max(255),
    cnpj: z.string().trim().min(11, 'CNPJ/CPF inválido').max(20, 'CNPJ/CPF inválido').optional(),
    nome_admin: z.string({ error: 'Informe o nome do administrador' }).trim().min(2, 'Nome do administrador muito curto').max(255),
    email_admin: z.string({ error: 'Informe o e-mail do administrador' }).trim().toLowerCase().email('E-mail do administrador inválido').max(255)
});

const paginaSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
});

module.exports = { loginPainelSchema, token2faSchema, trocarSenhaPainelSchema, criarEmpresaPainelSchema, paginaSchema };
