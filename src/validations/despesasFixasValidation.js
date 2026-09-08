const { z } = require('zod');

const CATEGORIAS = ['estrutural', 'pessoal', 'administrativa'];

// Strings 'YYYY-MM-DD', nunca viram Date — mesma técnica de
// pontoEquilibrioValidation.js (evita a armadilha de fuso do driver pg
// serializando um Date com getters locais).
const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const criarDespesaFixaSchema = z.object({
    categoria: z.enum(CATEGORIAS, { error: 'Categoria inválida' }),
    descricao: z.string({ error: 'Descrição é obrigatória' }).min(1, 'Descrição é obrigatória'),
    valor: z.coerce.number({ error: 'Valor é obrigatório' }).min(0, 'Valor não pode ser negativo'),
    vigencia_inicio: dataISO('Data de início de vigência inválida'),
    // null = sem data de término ("em vigor"); omitido também vira null no repository.
    vigencia_fim: dataISO('Data de fim de vigência inválida').nullable().optional()
}).strict().refine((data) => !data.vigencia_fim || data.vigencia_fim >= data.vigencia_inicio, {
    message: 'Data de fim de vigência não pode ser antes do início',
    path: ['vigencia_fim']
});

const atualizarDespesaFixaSchema = z.object({
    categoria: z.enum(CATEGORIAS, { error: 'Categoria inválida' }).optional(),
    descricao: z.string().min(1, 'Descrição é obrigatória').optional(),
    valor: z.coerce.number().min(0, 'Valor não pode ser negativo').optional(),
    vigencia_inicio: dataISO('Data de início de vigência inválida').optional(),
    vigencia_fim: dataISO('Data de fim de vigência inválida').nullable().optional()
}).strict()
    .refine((data) => Object.keys(data).length > 0, { message: 'Informe ao menos um campo para atualizar' })
    // só valida a relação entre os dois campos quando ambos vêm no mesmo payload —
    // o CHECK do banco (despesas_fixas_vigencia_check) é quem garante a consistência
    // final contra o valor já gravado quando só um dos dois é enviado.
    .refine((data) => !data.vigencia_fim || !data.vigencia_inicio || data.vigencia_fim >= data.vigencia_inicio, {
        message: 'Data de fim de vigência não pode ser antes do início',
        path: ['vigencia_fim']
    });

module.exports = {
    criarDespesaFixaSchema,
    atualizarDespesaFixaSchema
};
