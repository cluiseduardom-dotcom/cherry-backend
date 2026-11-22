const { z } = require('zod');

const id = (mensagem) => z.coerce.number({ error: mensagem }).int(mensagem).positive(mensagem);
const dinheiro = (mensagem) => z.coerce.number({ error: mensagem }).min(0, mensagem).max(1e9, mensagem);

const itemSchema = z.strictObject({
    produto_id: id('Produto inválido'),
    descricao: z.string({ error: 'Descrição inválida' }).trim().min(1, 'Descrição inválida').max(255, 'Descrição muito longa').optional(),
    // Estoque é inteiro (unidade-base): a quantidade pedida também.
    quantidade: z.coerce.number({ error: 'Quantidade deve ser um inteiro maior que zero' }).int('Quantidade deve ser um inteiro maior que zero').positive('Quantidade deve ser um inteiro maior que zero').max(1e9, 'Quantidade muito alta')
});

const criarCotacaoSchema = z.strictObject({
    itens: z.array(itemSchema, { error: 'Informe os itens' }).min(1, 'Informe ao menos um item').max(200, 'No máximo 200 itens'),
    fornecedor_ids: z.array(id('Fornecedor inválido'), { error: 'Informe os fornecedores' })
        .min(1, 'Informe ao menos um fornecedor').max(20, 'No máximo 20 fornecedores')
        .refine((lista) => new Set(lista).size === lista.length, 'Fornecedor repetido'),
    data_limite: z.iso.date({ error: 'Data limite inválida (use AAAA-MM-DD)' }).optional(),
    observacoes: z.string({ error: 'Observações inválidas' }).trim().max(1000, 'Observações muito longas').optional()
});

const ofertaItemSchema = z.strictObject({
    cotacao_item_id: id('Item da cotação inválido'),
    preco_unitario: dinheiro('Preço unitário inválido'),
    quantidade_ofertada: z.coerce.number({ error: 'Quantidade ofertada inválida' }).int('Quantidade ofertada inválida').positive('Quantidade ofertada inválida').max(1e9, 'Quantidade muito alta').optional(),
    desconto: dinheiro('Desconto inválido').optional(),
    prazo_entrega_dias: z.coerce.number({ error: 'Prazo de entrega inválido' }).int('Prazo de entrega inválido').min(0, 'Prazo de entrega inválido').max(365, 'Prazo de entrega máximo de 365 dias').optional(),
    condicao_pagamento: z.string({ error: 'Condição de pagamento inválida' }).trim().max(255, 'Condição de pagamento muito longa').optional()
});

const registrarOfertaSchema = z.strictObject({
    itens: z.array(ofertaItemSchema, { error: 'Informe as ofertas' }).min(1, 'Informe ao menos um item cotado').max(200, 'No máximo 200 itens')
        .refine((lista) => new Set(lista.map((i) => i.cotacao_item_id)).size === lista.length, 'Item repetido na proposta')
});

const gerarPedidosSchema = z.strictObject({
    escolhas: z.array(z.strictObject({ cotacao_item_id: id('Item da cotação inválido'), fornecedor_id: id('Fornecedor inválido') }), { error: 'Informe as escolhas' })
        .min(1, 'Escolha o fornecedor de ao menos um item').max(200, 'No máximo 200 itens')
        .refine((lista) => new Set(lista.map((e) => e.cotacao_item_id)).size === lista.length, 'Item escolhido duas vezes')
});

const STATUS_COTACAO = ['ABERTA', 'EM_ANALISE', 'ENCERRADA', 'CANCELADA'];

const listarCotacoesSchema = z.object({
    status: z.enum(STATUS_COTACAO, { error: 'Status inválido' }).optional()
});

module.exports = { criarCotacaoSchema, registrarOfertaSchema, gerarPedidosSchema, listarCotacoesSchema };
