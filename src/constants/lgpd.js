// Prazos de retenção PADRÃO (sugeridos; o PO valida com contador/advogado). Ver docs/LGPD.md.
const RETENCAO = Object.freeze({
    // Pedido pago da loja online: dados do comprador ficam 5 anos após o pagamento (prazo de reclamação do consumidor
    // e guarda de registros de venda), depois são anonimizados. O pedido e o valor continuam (histórico financeiro).
    PEDIDO_PAGO_ANOS: 5,
    // Pedido que nunca foi pago (cancelado ou expirado): sem venda nem obrigação, 90 dias depois de encerrado.
    PEDIDO_NAO_PAGO_DIAS: 90,
    // Colaborador bloqueado: dados cadastrais (CPF, nascimento, endereço, telefone) e foto, 5 anos depois do bloqueio.
    COLABORADOR_ANOS: 5
});

// Marcador do dado anonimizado (também é o que torna a rotina idempotente).
const ANONIMIZADO = Object.freeze({
    NOME: '[anonimizado]',
    EMAIL: 'anonimizado@invalido.local'
});

module.exports = { RETENCAO, ANONIMIZADO };
