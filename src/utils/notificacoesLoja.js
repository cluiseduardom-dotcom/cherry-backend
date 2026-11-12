// Regras PURAS dos avisos da loja online no sino (sem banco). Recebem linhas já consultadas e devolvem avisos no mesmo
// formato do sino. Só para quem fala com a cliente (administrador e vendedor): trazem nome e telefone dela. Nunca trazem
// custo, margem, taxa da plataforma nem dado do provedor.
const LIMITES_LOJA = Object.freeze({ PEDIDO_PAGO_ALTA_HORAS: 24 });

const TIPOS_LOJA = Object.freeze({
    PEDIDO_PAGO: 'loja_pedido_pago',
    PAGAMENTO_SEM_VENDA: 'loja_pagamento_sem_venda',
    PAGAMENTO_ESTORNADO: 'loja_pagamento_estornado'
});

const moeda = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
const curto = (codigo) => String(codigo).slice(0, 8).toUpperCase();

function aviso(tipo, pedido, prioridade, titulo, mensagem, acao, dados) {
    return {
        id: `${tipo}:${pedido.id}`,
        tipo,
        prioridade,
        produto_id: null,
        sku: null,
        nome: null,
        item: 'pedido',
        pedido_codigo: pedido.codigo,
        titulo,
        mensagem,
        acao,
        dados
    };
}

const contato = (p) => (p.cliente_telefone ? ` Telefone: ${p.cliente_telefone}.` : '');

// aCombinar: { id, codigo, cliente_nome, cliente_telefone, total, horas }
// semVenda:  { id, codigo, status, cliente_nome, cliente_telefone, total }
// estornadas: { id, codigo, cliente_nome, cliente_telefone, total } — pagamento estornado ou contestado no Mercado Pago, mas a venda segue ativa
function montarNotificacoesLoja({ aCombinar = [], semVenda = [], estornadas = [] }, perfil) {
    if (!perfil.administrador && !perfil.vendedor) return [];

    const itens = [];

    for (const p of aCombinar) {
        const horas = Number(p.horas) || 0;
        const espera = horas < 1 ? 'agora há pouco' : horas < 48 ? `há ${horas} h` : `há ${Math.floor(horas / 24)} dias`;

        itens.push(aviso(
            TIPOS_LOJA.PEDIDO_PAGO, p,
            horas >= LIMITES_LOJA.PEDIDO_PAGO_ALTA_HORAS ? 'alta' : 'media',
            'Pedido da loja online pago',
            `Pedido ${curto(p.codigo)} (${moeda(p.total)}) de ${p.cliente_nome} foi pago ${espera}.${contato(p)}`,
            'Combinar o frete e a entrega com a cliente e marcar como combinado.',
            { pedido_id: Number(p.id), total: Number(p.total), horas }
        ));
    }

    for (const p of semVenda) {
        const expirado = p.status === 'expirado';

        itens.push(aviso(
            TIPOS_LOJA.PAGAMENTO_SEM_VENDA, p, 'alta',
            'Pagamento da loja sem venda',
            expirado
                ? `Pedido ${curto(p.codigo)} (${moeda(p.total)}) de ${p.cliente_nome} foi pago depois de a reserva expirar e a peça não está mais disponível.${contato(p)}`
                : `Pedido ${curto(p.codigo)} (${moeda(p.total)}) de ${p.cliente_nome}: o pagamento foi recebido, mas o pedido ainda não virou venda.${contato(p)}`,
            expirado
                ? 'Avisar a cliente e devolver o pagamento (Pix a devolver; cartão pelo painel do Mercado Pago).'
                : 'Aguardar a conversão automática; se persistir, falar com a GiroNex.',
            { pedido_id: Number(p.id), total: Number(p.total), situacao: p.status }
        ));
    }

    for (const p of estornadas) {
        itens.push(aviso(
            TIPOS_LOJA.PAGAMENTO_ESTORNADO, p, 'alta',
            'Pagamento da loja estornado',
            `O pagamento do pedido ${curto(p.codigo)} (${moeda(p.total)}) de ${p.cliente_nome} foi estornado ou contestado no Mercado Pago, mas a venda continua registrada.${contato(p)}`,
            'Se a compra foi desfeita, cancele a venda pelo Histórico de vendas; se não, confira o pagamento no painel do Mercado Pago.',
            { pedido_id: Number(p.id), total: Number(p.total) }
        ));
    }

    return itens;
}

module.exports = { montarNotificacoesLoja, TIPOS_LOJA, LIMITES_LOJA };
