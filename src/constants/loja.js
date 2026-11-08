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
    LIMITE_PADRAO: 24,
    LIMITE_MAXIMO: 48
};
