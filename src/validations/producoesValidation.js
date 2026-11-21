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

const necessidadeSchema = z.object({
    produto_id: z.coerce.number({ error: 'Produto inválido' }).int('Produto inválido').positive('Produto inválido'),
    quantidade: z.coerce.number({ error: 'Quantidade deve ser um inteiro maior que zero' })
        .int('Quantidade deve ser um inteiro maior que zero')
        .positive('Quantidade deve ser um inteiro maior que zero')
        .max(1000000, 'Quantidade máxima de 1.000.000')
        .default(1)
});

module.exports = { criarProducaoSchema, listarProducoesSchema, necessidadeSchema };
