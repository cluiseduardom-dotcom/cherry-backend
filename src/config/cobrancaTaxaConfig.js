// Instrução de pagamento da taxa da plataforma (extrato e mensagem de cobrança do Painel GiroNex).
//   TAXA_COBRANCA_PIX_CHAVE   chave Pix da GiroNex que recebe a taxa (CPF/CNPJ, e-mail, telefone ou chave aleatória)
//   TAXA_COBRANCA_FAVORECIDO  nome do favorecido, como aparece no Pix (opcional)
// Não são segredos (o lojista precisa enxergar), mas ficam no ambiente, não no código: trocar a conta de
// recebimento não exige deploy de código. Sem a chave, o extrato sai sem instrução de pagamento.

const MAX_CHAVE = 140;
const MAX_FAVORECIDO = 100;

// Texto de uma linha só, sem caracteres de controle (a chave vai para PDF e para link de WhatsApp).
function limpar(valor, max) {
    if (typeof valor !== 'string') return null;
    const texto = valor.trim();
    if (!texto || texto.length > max || /[\u0000-\u001f\u007f]/.test(texto)) return null;
    return texto;
}

// → { chave_pix, favorecido|null } ou null quando não configurada (ou inválida: falha para "sem instrução").
function obterInstrucaoPagamento(env = process.env) {
    const chave = limpar(env.TAXA_COBRANCA_PIX_CHAVE, MAX_CHAVE);
    if (!chave) return null;

    return { chave_pix: chave, favorecido: limpar(env.TAXA_COBRANCA_FAVORECIDO, MAX_FAVORECIDO) };
}

module.exports = { obterInstrucaoPagamento, MAX_CHAVE, MAX_FAVORECIDO };
