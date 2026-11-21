const { z } = require('zod');

const MAX_ITENS = 200;
const dinheiro = (mensagem) => z.coerce.number({ error: mensagem }).min(0, mensagem).max(1e9, mensagem);

const itemSchema = z.strictObject({
    produto_id: z.coerce.number({ error: 'Produto inválido' }).int('Produto inválido').positive('Produto inválido'),
    descricao: z.string({ error: 'Descrição inválida' }).trim().min(1, 'Descrição inválida').max(255, 'Descrição muito longa').optional(),
    // Estoque é inteiro (gramas, ml...): o pedido também. Decimal de kg/L é só da tela.
    quantidade: z.coerce.number({ error: 'Quantidade deve ser um inteiro maior que zero' }).int('Quantidade deve ser um inteiro maior que zero').positive('Quantidade deve ser um inteiro maior que zero').max(1e9, 'Quantidade muito alta'),
    preco_unitario: dinheiro('Preço unitário inválido'),
    desconto: dinheiro('Desconto do item inválido').optional()
});

const cabecalho = {
    fornecedor_id: z.coerce.number({ error: 'Fornecedor é obrigatório' }).int('Fornecedor inválido').positive('Fornecedor é obrigatório'),
    data_prevista_entrega: z.iso.date({ error: 'Data prevista inválida (use AAAA-MM-DD)' }).optional(),
    condicao_pagamento: z.string({ error: 'Condição de pagamento inválida' }).trim().max(100, 'Condição de pagamento muito longa').optional(),
    prazo_pagamento_dias: z.coerce.number({ error: 'Prazo de pagamento inválido' }).int('Prazo de pagamento inválido').min(0, 'Prazo de pagamento inválido').max(365, 'Prazo de pagamento máximo de 365 dias').optional(),
    forma_pagamento: z.string({ error: 'Forma de pagamento inválida' }).trim().max(30, 'Forma de pagamento muito longa').optional(),
    frete_valor: dinheiro('Frete inválido').optional(),
    desconto: dinheiro('Desconto inválido').optional(),
    outras_despesas: dinheiro('Outras despesas inválidas').optional(),
    observacoes: z.string({ error: 'Observações inválidas' }).trim().max(1000, 'Observações muito longas').optional(),
    itens: z.array(itemSchema, { error: 'Informe os itens' }).min(1, 'Informe ao menos um item').max(MAX_ITENS, `No máximo ${MAX_ITENS} itens`)
};

// Número opcional (padrão: PC-AAAA-NNNN, gerado pelo sistema). Nada de empresa_id, status ou total vindo do corpo.
const criarPedidoSchema = z.strictObject({
    numero: z.string({ error: 'Número inválido' }).trim().min(1, 'Número inválido').max(30, 'Número muito longo').optional(),
    ...cabecalho
});

const atualizarPedidoSchema = z.strictObject(cabecalho);

const STATUS_PEDIDO = ['RASCUNHO', 'PENDENTE_APROVACAO', 'APROVADO', 'ENVIADO', 'CONFIRMADO', 'PARCIALMENTE_RECEBIDO', 'RECEBIDO', 'CANCELADO'];

const listarPedidosSchema = z.object({
    status: z.enum(STATUS_PEDIDO, { error: 'Status inválido' }).optional(),
    fornecedor_id: z.coerce.number({ error: 'Fornecedor inválido' }).int('Fornecedor inválido').positive('Fornecedor inválido').optional()
});

module.exports = { criarPedidoSchema, atualizarPedidoSchema, listarPedidosSchema };
