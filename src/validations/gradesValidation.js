const { z } = require('zod');

const MAX_VARIACOES = 100;

const inteiroPositivo = (mensagem) => z.coerce.number({ error: mensagem }).int(mensagem).positive(mensagem);
const texto = (mensagem, max) => z.string({ error: mensagem }).trim().min(1, mensagem).max(max, `${mensagem} (máximo de ${max} caracteres)`);

const eixoSchema = texto('Eixo da grade inválido', 30);

const eixosSchema = z.array(eixoSchema, { error: 'Informe os eixos da grade (ex.: Tamanho, Cor)' })
    .min(1, 'Informe ao menos um eixo da grade')
    .max(3, 'A grade aceita no máximo 3 eixos')
    .refine((eixos) => new Set(eixos.map((e) => e.toLowerCase())).size === eixos.length, { message: 'Eixo repetido na grade' });

const variacaoSchema = z.object({
    // Os valores são conferidos contra os eixos da grade no serviço (na criação, os do corpo; depois, os da grade).
    valores: z.record(z.string(), z.unknown(), { error: 'Informe os valores da variação' }),
    categoria_ids: z.array(inteiroPositivo('Categoria inválida')).max(10).optional(),
    custo: z.coerce.number({ error: 'Custo da variação inválido' }).positive('Custo da variação deve ser maior que zero').optional()
}).strict();

const variacoesSchema = z.array(variacaoSchema, { error: 'Informe as variações' })
    .min(1, 'Informe ao menos uma variação')
    .max(MAX_VARIACOES, `No máximo ${MAX_VARIACOES} variações por vez`);

const criarGradeSchema = z.object({
    nome: texto('Nome da grade é obrigatório', 255),
    descricao: z.string({ error: 'Descrição inválida' }).trim().max(1000, 'Descrição muito longa').optional(),
    eixos: eixosSchema,
    custo: z.coerce.number({ error: 'Custo é obrigatório' }).positive('Custo deve ser maior que zero'),
    preco_venda: z.coerce.number({ error: 'Preço de venda inválido' }).positive('Preço de venda deve ser maior que zero').optional(),
    unidade: z.enum(['UN', 'PAR', 'CX', 'PCT', 'G', 'ML'], { error: 'Unidade inválida' }).optional(),
    estoque_minimo: z.coerce.number({ error: 'Estoque mínimo inválido' }).int('Estoque mínimo inválido').nonnegative('Estoque mínimo inválido').optional(),
    categoria_ids: z.array(inteiroPositivo('Categoria inválida')).max(10).optional(),
    variacoes: variacoesSchema
}).strict();

const acrescentarVariacoesSchema = z.object({ variacoes: variacoesSchema }).strict();

const atualizarGradeSchema = z.object({
    nome: texto('Nome da grade é obrigatório', 255).optional(),
    descricao: z.string({ error: 'Descrição inválida' }).trim().max(1000, 'Descrição muito longa').optional()
}).strict().refine((d) => Object.keys(d).length > 0, { message: 'Informe ao menos um campo para atualizar' });

module.exports = { criarGradeSchema, acrescentarVariacoesSchema, atualizarGradeSchema, MAX_VARIACOES };
