const { z } = require('zod');
const { cnpjValido, UFS } = require('../utils/documentos');

// Texto vazio vira null (limpar o campo opcional). `strict`: campo desconhecido (empresa_id,
// status, tema_visual...) é recusado, nunca ignorado.
const soDigitos = (v) => v.replace(/\D/g, '');
const vazioParaNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const opcional = (schema) => z.preprocess(vazioParaNull, schema.nullable().optional());
const texto = (rotulo, max) => z.string({ error: `${rotulo} inválido` }).trim().max(max, `${rotulo} muito longo`);

const atualizarDadosEmpresaSchema = z.strictObject({
    nome: z.string({ error: 'Nome é obrigatório' }).trim().min(1, 'Nome é obrigatório').max(255, 'Nome muito longo').optional(),
    razao_social: opcional(texto('Razão social', 255)),
    cnpj: opcional(z.string().transform(soDigitos).refine(cnpjValido, 'CNPJ inválido')),
    telefone: opcional(z.string().transform(soDigitos).refine((v) => /^\d{10,11}$/.test(v), 'Telefone inválido (use DDD + número)')),
    email_contato: opcional(z.string().trim().max(254, 'E-mail muito longo').email('E-mail inválido')),
    cep: opcional(z.string().transform(soDigitos).refine((v) => /^\d{8}$/.test(v), 'CEP inválido')),
    logradouro: opcional(texto('Logradouro', 255)),
    numero: opcional(texto('Número', 20)),
    complemento: opcional(texto('Complemento', 100)),
    bairro: opcional(texto('Bairro', 100)),
    cidade: opcional(texto('Cidade', 100)),
    uf: opcional(z.string().trim().toUpperCase().refine((v) => UFS.includes(v), 'UF inválida'))
}).refine((d) => Object.keys(d).length > 0, 'Informe ao menos um campo para atualizar');

module.exports = { atualizarDadosEmpresaSchema };
