const { z } = require('zod');

const criarFichaTecnicaSchema = z.object({
    // Quantas unidades do acabado UMA receita rende (padrão 1). A quantidade de cada insumo é por receita.
    rendimento: z.coerce.number({ error: 'Rendimento deve ser um inteiro maior que zero' })
        .int('Rendimento deve ser um inteiro maior que zero')
        .positive('Rendimento deve ser um inteiro maior que zero')
        .max(1000000, 'Rendimento máximo de 1.000.000')
        .default(1),
    itens: z.array(
        z.object({
            insumo_produto_id: z.coerce.number({ error: 'Insumo inválido' }).int().positive('Insumo inválido'),
            quantidade_necessaria: z.coerce.number({ error: 'Quantidade necessária deve ser maior que zero' }).int('Quantidade necessária deve ser maior que zero').positive('Quantidade necessária deve ser maior que zero')
        }).strict()
    ).min(1, 'A ficha técnica deve ter ao menos um item')
}).strict().refine(
    (data) => new Set(data.itens.map((item) => item.insumo_produto_id)).size === data.itens.length,
    { message: 'Insumo repetido na ficha técnica', path: ['itens'] }
);

module.exports = { criarFichaTecnicaSchema };
