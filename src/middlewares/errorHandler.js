const MENSAGEM_ERRO_INTERNO = 'Erro interno do servidor';

// Erros do driver pg que são causados por entrada do cliente, não por falha do
// servidor: viram 400 com texto genérico (nunca o texto do banco).
const ERROS_PG_ENTRADA_INVALIDA = new Map([
    ['22003', 'Valor numérico fora do intervalo permitido'],
    ['22P02', 'Valor em formato inválido'],
    ['22007', 'Data em formato inválido'],
    ['22008', 'Data fora do intervalo permitido']
]);

const MENSAGENS_HTTP_GENERICAS = {
    400: 'Requisição inválida',
    413: 'Corpo da requisição muito grande',
    415: 'Tipo de conteúdo não suportado'
};

module.exports = (err, req, res, next) => {

    // Detalhe completo só em log; nunca na resposta.
    console.error(err);

    if (err.isOperational !== true && ERROS_PG_ENTRADA_INVALIDA.has(err.code)) {
        return res.status(400).json({ success: false, message: ERROS_PG_ENTRADA_INVALIDA.get(err.code) });
    }

    const status = Number.isInteger(err.statusCode) ? err.statusCode : (Number.isInteger(err.status) ? err.status : 500);

    if (status >= 500 || status < 400) {
        return res.status(500).json({ success: false, message: MENSAGEM_ERRO_INTERNO });
    }

    // AppError carrega mensagem escrita para o cliente. Qualquer outro erro 4xx
    // (ex.: body-parser) usa texto genérico por status.
    const message = err.isOperational === true
        ? err.message
        : (MENSAGENS_HTTP_GENERICAS[status] || 'Requisição inválida');

    return res.status(status).json({ success: false, message });

};
