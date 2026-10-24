const { z } = require('zod');

const idPositivo = (rotulo) => z.coerce.number({ error: `${rotulo} inválido` }).int(`${rotulo} inválido`).positive(`${rotulo} inválido`);
const motivo = z.string({ error: 'Motivo é obrigatório' }).trim().min(3, 'Motivo deve ter ao menos 3 caracteres').max(300, 'Motivo muito longo');

const criarTransferenciaSchema = z.object({
    origem_local_id: idPositivo('Local de origem'),
    destino_local_id: idPositivo('Local de destino'),
    itens: z.array(z.object({
        produto_id: idPositivo('Produto'),
        quantidade: idPositivo('Quantidade').max(1000000, 'Quantidade muito alta')
    }).strict(), { error: 'Informe os itens' })
        .min(1, 'Informe ao menos um item')
        .max(200, 'Máximo de 200 itens por transferência'),
    observacao: z.string().trim().max(500, 'Observação muito longa').optional()
}).strict().refine((d) => d.origem_local_id !== d.destino_local_id, { message: 'Origem e destino devem ser diferentes', path: ['destino_local_id'] })
    .refine((d) => new Set(d.itens.map((i) => i.produto_id)).size === d.itens.length, { message: 'Produto repetido nos itens', path: ['itens'] });

const aceitarSchema = z.object({}).strict();
const recusarOuCancelarSchema = z.object({ motivo }).strict();

const criarLocalSchema = z.discriminatedUnion('tipo', [
    z.object({
        tipo: z.literal('maleta'),
        usuario_id: idPositivo('Usuário'),
        nome: z.string().trim().min(1).max(100).optional()
    }).strict(),
    z.object({
        tipo: z.literal('consignado'),
        nome: z.string({ error: 'Nome é obrigatório' }).trim().min(1, 'Nome é obrigatório').max(100, 'Nome muito longo'),
        cliente_id: idPositivo('Cliente').optional()
    }).strict()
], { error: 'Tipo de local inválido (use maleta ou consignado)' });

const listarTransferenciasSchema = z.object({
    status: z.enum(['pendente', 'concluida', 'recusada', 'cancelada'], { error: 'Status inválido' }).optional()
});

module.exports = { criarTransferenciaSchema, aceitarSchema, recusarOuCancelarSchema, criarLocalSchema, listarTransferenciasSchema };
