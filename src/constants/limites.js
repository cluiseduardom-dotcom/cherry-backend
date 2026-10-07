// Tetos de entrada compartilhados por validations e repositories. Valores de
// negócio (parcelas/prazo) são conservadores e centralizados aqui para serem
// ajustados em um único lugar caso o Product Owner defina outros limites.
module.exports = {
    MAX_PARCELAS: 24,
    MAX_MESES_PRAZO: 24,
    MAX_DIAS_PRAZO: 365,
    MAX_ITENS_POR_DOCUMENTO: 200,
    MAX_PAGAMENTOS_POR_VENDA: 10,
    MAX_QUANTIDADE_ITEM: 100000,
    // Cabe nas colunas NUMERIC(15,2) com folga.
    MAX_VALOR_MONETARIO: 999999999.99
};
