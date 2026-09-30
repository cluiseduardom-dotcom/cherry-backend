const { z } = require('zod');

// data_nascimento fica como string 'YYYY-MM-DD' (z.iso.date), nunca vira
// Date — mesma armadilha de fuso horário já documentada em CLAUDE.md
// (`z.coerce.date` grava um dia a menos em servidor com fuso negativo).
const dataISO = (mensagem) => z.iso.date({ error: mensagem });

function normalizarDigitos(valor) {
    return valor.replace(/\D/g, '');
}

// Só valida quantidade de dígitos (11 = CPF, 14 = CNPJ) — sem checar dígito
// verificador, mesmo padrão de fornecedoresValidation.js.
const cpfCnpj = z.string()
    .optional()
    .refine((valor) => valor === undefined || /^\d{11}$|^\d{14}$/.test(normalizarDigitos(valor)), {
        message: 'CPF/CNPJ inválido'
    });

const criarClienteSchema = z.object({
    nome: z.string({ error: 'Nome é obrigatório' }).min(1, 'Nome é obrigatório'),
    telefone: z.string({ error: 'Telefone inválido' }).optional(),
    email: z.string({ error: 'Email inválido' }).email('Email inválido').optional(),
    cpf_cnpj: cpfCnpj,
    cep: z.string().optional(),
    endereco: z.string().optional(),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    uf: z.string().length(2).optional(),
    data_nascimento: dataISO('Data de nascimento inválida').optional(),
    observacoes: z.string().optional()
}).strict();

const atualizarClienteSchema = z.object({
    nome: z.string().min(1, 'Nome é obrigatório').optional(),
    telefone: z.string().optional(),
    email: z.string().email('Email inválido').optional(),
    cpf_cnpj: cpfCnpj,
    cep: z.string().optional(),
    endereco: z.string().optional(),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    uf: z.string().length(2).optional(),
    data_nascimento: dataISO('Data de nascimento inválida').optional(),
    observacoes: z.string().optional(),
    ativo: z.boolean().optional()
}).strict().refine((data) => Object.keys(data).length > 0, { message: 'Informe ao menos um campo para atualizar' });

module.exports = {
    criarClienteSchema,
    atualizarClienteSchema
};
