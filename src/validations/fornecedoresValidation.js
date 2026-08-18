const { z } = require('zod');

function normalizarDigitos(valor) {
    return valor.replace(/\D/g, '');
}

// Só valida quantidade de dígitos (11 = CPF, 14 = CNPJ) — sem checar dígito
// verificador por enquanto, conforme pedido.
const cnpjCpf = z.string()
    .optional()
    .refine((valor) => valor === undefined || /^\d{11}$|^\d{14}$/.test(normalizarDigitos(valor)), {
        message: 'CNPJ/CPF inválido'
    });

const criarFornecedorSchema = z.object({
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório'),
    contato: z.string().optional(),
    telefone: z.string().optional(),
    email: z.string().email('Email inválido').optional(),
    cnpj_cpf: cnpjCpf,
    observacoes: z.string().optional()
}).strict();

const atualizarFornecedorSchema = z.object({
    nome: z.string().min(1, 'Nome é obrigatório').optional(),
    contato: z.string().optional(),
    telefone: z.string().optional(),
    email: z.string().email('Email inválido').optional(),
    cnpj_cpf: cnpjCpf,
    observacoes: z.string().optional(),
    ativo: z.boolean().optional()
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'Informe ao menos um campo para atualizar' });

module.exports = {
    criarFornecedorSchema,
    atualizarFornecedorSchema
};
