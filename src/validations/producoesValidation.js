const { z } = require('zod');

const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const criarProducaoSchema = z.object({
    produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido'),
    quantidade_solicitada: z.coerce.number({ error: 'Quantidade solicitada deve ser maior que zero' }).int('Quantidade solicitada deve ser maior que zero').positive('Quantidade solicitada deve ser maior que zero')
}).strict();

const listarProducoesSchema = z.object({
    produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido').optional(),
    data_de: dataISO('Data inicial inválida').optional(),
    data_ate: dataISO('Data final inválida').optional()
});

module.exports = { criarProducaoSchema, listarProducoesSchema };
