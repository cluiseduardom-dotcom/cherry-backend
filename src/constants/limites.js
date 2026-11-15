// Tetos de entrada compartilhados por validations e repositories. Valores de
// negócio (parcelas/prazo) são conservadores e centralizados aqui para serem
// ajustados em um único lugar caso o Product Owner defina outros limites.
module.exports = {
    MAX_PARCELAS: 24,
    // Crediário (decisão do PO, 15/11/2026): o ÚLTIMO vencimento fica a no máximo 6 meses da venda.
    // A parcela N vence em N × meses_prazo meses; logo, parcelas × meses_prazo <= 6 (12x de 1 mês não cabe; 6x de 1, 3x de 2 e 2x de 3 cabem).
    // Vale para o crediário e para a venda a prazo (legado), que é uma conta única com vencimento em meses_prazo meses.
    MAX_MESES_PRAZO: 6,
    MAX_HORIZONTE_CREDIARIO_MESES: 6,
    MAX_DIAS_PRAZO: 365,
    MAX_ITENS_POR_DOCUMENTO: 200,
    MAX_PAGAMENTOS_POR_VENDA: 10,
    MAX_QUANTIDADE_ITEM: 100000,
    // Cabe nas colunas NUMERIC(15,2) com folga.
    MAX_VALOR_MONETARIO: 999999999.99
};
