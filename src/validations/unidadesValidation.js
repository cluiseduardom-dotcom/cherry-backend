const { z } = require('zod');

const listarUnidadesSchema = z.object({
    produto_id: z.coerce.number({ error: 'Produto inválido' }).int('Produto inválido').positive('Produto inválido').optional(),
    status: z.enum(['em_estoque', 'vendida', 'devolvida', 'baixada'], { error: 'Status inválido' }).optional(),
    busca: z.string().trim().max(40, 'Busca muito longa').optional(),
    page: z.coerce.number().int().min(1).optional().catch(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().catch(20)
});

module.exports = { listarUnidadesSchema };
