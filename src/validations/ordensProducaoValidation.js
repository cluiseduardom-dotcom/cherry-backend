const { z } = require('zod');

const inteiro = (mensagem) => z.coerce.number({ error: mensagem }).int(mensagem);

const criarOrdemSchema = z.object({
    produto_id: inteiro('Produto inválido').positive('Produto inválido'),
    quantidade_planejada: inteiro('Quantidade planejada deve ser um inteiro maior que zero')
        .positive('Quantidade planejada deve ser um inteiro maior que zero')
        .max(1000000, 'Quantidade máxima de 1.000.000'),
    prazo: z.iso.date({ error: 'Prazo inválido (use AAAA-MM-DD)' }).optional(),
    observacao: z.string({ error: 'Observação inválida' }).trim().max(500, 'Observação deve ter até 500 caracteres').optional()
}).strict();

const listarOrdensSchema = z.object({
    status: z.enum(['planejada', 'em_producao', 'concluida', 'cancelada'], { error: 'Status inválido' }).optional(),
    produto_id: inteiro('Produto inválido').positive('Produto inválido').optional()
});

const concluirOrdemSchema = z.object({
    quantidade_produzida: inteiro('Quantidade produzida deve ser um inteiro maior ou igual a zero').min(0, 'Quantidade produzida deve ser um inteiro maior ou igual a zero').max(1000000, 'Quantidade máxima de 1.000.000'),
    quantidade_perdida: inteiro('Quantidade perdida deve ser um inteiro maior ou igual a zero').min(0, 'Quantidade perdida deve ser um inteiro maior ou igual a zero').max(1000000, 'Quantidade máxima de 1.000.000').default(0)
}).strict().refine((d) => d.quantidade_produzida + d.quantidade_perdida >= 1, {
    message: 'Informe ao menos uma unidade produzida ou perdida',
    path: ['quantidade_produzida']
});

const cancelarOrdemSchema = z.object({
    motivo: z.string({ error: 'Motivo é obrigatório' }).trim().min(3, 'Motivo deve ter ao menos 3 caracteres').max(200, 'Motivo deve ter até 200 caracteres')
}).strict();

module.exports = { criarOrdemSchema, listarOrdensSchema, concluirOrdemSchema, cancelarOrdemSchema };
