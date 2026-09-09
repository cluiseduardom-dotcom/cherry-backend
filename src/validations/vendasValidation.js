const { z } = require('zod');

// preco_unitario nunca é aceito do cliente: o preço de cada item é sempre o
// preço vigente do produto no canal informado (módulo de precificação),
// travado no momento da criação da venda.
//
// meses_prazo só é obrigatório quando forma_pagamento = 'prazo': é ele que
// define data_vencimento da conta a receber gerada (data da venda + meses_prazo
// em meses de calendário), dentro da mesma transação de vendasRepository.criar.
// Venda à vista não gera conta a receber, então meses_prazo não se aplica.
//
// kit_id agrupa itens montados como "kit" no PDV (PR 1/2, sem desconto ainda):
// ausente/null = item avulso (comportamento inalterado); presente precisa ser
// inteiro >= 1. Não é global nem referência a outra tabela — é sequencial
// dentro do próprio payload (1, 2, 3...), então dois itens com o mesmo kit_id
// formam um grupo. Kit é montado do zero a cada venda, sem cadastro prévio,
// por isso a única regra de negócio validável aqui é o tamanho do grupo: cada
// kit_id usado precisa aparecer em pelo menos 2 itens.
const criarVendaSchema = z.object({
    cliente_id: z.coerce.number({ error: 'Cliente inválido' }).int().positive('Cliente inválido').optional(),
    canal: z.string().min(1, 'Canal inválido').optional(),
    forma_pagamento: z.enum(['a_vista', 'prazo'], { error: 'Forma de pagamento inválida' }).optional(),
    meses_prazo: z.coerce.number({ error: 'Prazo em meses deve ser maior que zero' }).int().positive('Prazo em meses deve ser maior que zero').optional(),
    itens: z.array(
        z.object({
            produto_id: z.coerce.number({ error: 'Produto inválido' }).int().positive('Produto inválido'),
            quantidade: z.coerce.number({ error: 'Quantidade deve ser maior que zero' }).int().positive('Quantidade deve ser maior que zero'),
            kit_id: z.coerce.number({ error: 'kit_id inválido' }).int().positive('kit_id inválido').nullish()
        }).strict()
    ).min(1, 'A venda deve ter ao menos um item')
}).strict().refine((data) => data.forma_pagamento !== 'prazo' || data.meses_prazo !== undefined, {
    message: 'Informe meses_prazo para vendas a prazo',
    path: ['meses_prazo']
}).refine((data) => {
    const contagemPorKit = new Map();

    for (const item of data.itens) {
        if (item.kit_id == null) continue;
        contagemPorKit.set(item.kit_id, (contagemPorKit.get(item.kit_id) ?? 0) + 1);
    }

    return [...contagemPorKit.values()].every((quantidade) => quantidade >= 2);
}, {
    message: 'Kit precisa ter ao menos 2 componentes',
    path: ['itens']
});

module.exports = {
    criarVendaSchema
};
