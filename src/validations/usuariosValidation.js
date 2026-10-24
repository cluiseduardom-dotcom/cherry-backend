const { z } = require('zod');
const { CARGOS } = require('../constants/cargos');
const { cpfValido, UFS } = require('../utils/documentos');

// Mesmas regras de nome/e-mail/senha de POST /auth/register, para não haver dois padrões.
// `strict`: campo desconhecido (ex.: empresa_id, ativo) é recusado, nunca ignorado.

// ---- Dados cadastrais -------------------------------------------------------------------------
// Texto vazio vira null (limpar o campo); datas ficam 'YYYY-MM-DD' (nunca Date: fuso horário).
const soDigitos = (v) => v.replace(/\D/g, '');
const vazioParaNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const opcional = (schema) => z.preprocess(vazioParaNull, schema.nullable().optional());
const hoje = () => new Date().toISOString().slice(0, 10);

const textoCurto = (rotulo, max) => z.string({ error: `${rotulo} inválido` }).trim().max(max, `${rotulo} muito longo`);

const telefone = z.string({ error: 'Telefone é obrigatório' })
    .transform(soDigitos)
    .refine((v) => /^\d{10,11}$/.test(v), 'Telefone inválido (use DDD + número)');

const camposOpcionais = {
    cpf: opcional(z.string().transform(soDigitos).refine(cpfValido, 'CPF inválido')),
    data_nascimento: opcional(z.iso.date({ error: 'Data de nascimento inválida' })
        .refine((v) => v >= '1900-01-01' && v <= hoje(), 'Data de nascimento inválida')),
    data_admissao: opcional(z.iso.date({ error: 'Data de admissão inválida' })
        .refine((v) => v >= '1950-01-01', 'Data de admissão inválida')),
    cep: opcional(z.string().transform(soDigitos).refine((v) => /^\d{8}$/.test(v), 'CEP inválido')),
    logradouro: opcional(textoCurto('Logradouro', 255)),
    numero: opcional(textoCurto('Número', 20)),
    complemento: opcional(textoCurto('Complemento', 100)),
    bairro: opcional(textoCurto('Bairro', 100)),
    cidade: opcional(textoCurto('Cidade', 100)),
    uf: opcional(z.string().trim().toUpperCase().refine((v) => UFS.includes(v), 'UF inválida')),
    observacoes: opcional(textoCurto('Observações', 1000))
};

const CAMPOS_DADOS = ['telefone', ...Object.keys(camposOpcionais)];

// Edição parcial: só vale o que vier; null limpa (menos o telefone, que é obrigatório).
const editarDadosSchema = z.object({ telefone: telefone.optional(), ...camposOpcionais })
    .strict()
    .refine((d) => Object.keys(d).length > 0, 'Informe ao menos um campo');

const criarUsuarioSchema = z.object({
    nome: z.string().trim().min(1, 'Nome é obrigatório').max(255, 'Nome muito longo'),
    email: z.string().trim().email('Email inválido').max(255, 'Email muito longo'),
    senha: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres').max(128, 'Senha muito longa'),
    papel: z.enum(CARGOS, { message: 'Papel inválido' }),
    telefone,
    ...camposOpcionais
}).strict();

const bloqueioSchema = z.object({
    bloqueado: z.boolean({ error: 'Informe se o usuário deve ficar bloqueado' }),
    motivo: z.string({ error: 'Motivo é obrigatório' }).trim().min(3, 'Motivo deve ter ao menos 3 caracteres').max(300, 'Motivo muito longo')
}).strict();

const usuarioIdSchema = z.coerce.number({ error: 'Usuário inválido' }).int('Usuário inválido').positive('Usuário inválido');

module.exports = {
    criarUsuarioSchema,
    editarDadosSchema,
    CAMPOS_DADOS,
    bloqueioSchema,
    usuarioIdSchema
};
