// Regras da loja online (decisões do Product Owner, 08/11/2026).
module.exports = {
    // "Novidades": peça cuja PRIMEIRA entrada de estoque (qualquer origem) foi nos últimos N dias.
    NOVIDADE_DIAS: 30,
    // "Mais vendidos" só aparece quando pelo menos este número de peças tem venda finalizada.
    MINIMO_PECAS_MAIS_VENDIDOS: 4,
    // Itens de cada vitrine da página inicial.
    ITENS_POR_VITRINE: 8,
    // A galeria do produto tem no máximo 5 fotos (produto_imagens); a API nunca devolve mais que isso.
    MAX_FOTOS_PUBLICAS: 5,
    // Estoque exibido é limitado: acima disso a loja só sabe que "há estoque". Não expõe o saldo real.
    QUANTIDADE_MAXIMA_EXIBIDA: 10,
    // Pedido: quanto tempo a peça fica separada esperando o pagamento (o QR do Pix vale 30 min). Decisão
    // provisória a confirmar com o PO; vencido o prazo, a peça volta ao Central.
    RESERVA_MINUTOS: 30,
    MAX_ITENS_POR_PEDIDO: 20,
    MAX_QUANTIDADE_POR_ITEM: 10,
    // Freio contra quem reserva o estoque sem pagar: pedidos abertos por e-mail.
    MAX_PEDIDOS_ABERTOS_POR_EMAIL: 3,
    LIMITE_PADRAO: 24,
    LIMITE_MAXIMO: 48
};
