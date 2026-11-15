const AppError = require('../errors/AppError');
const cobrancaTaxaRepository = require('../repositories/cobrancaTaxaRepository');
const { obterCicloCobranca } = require('../config/cicloCobrancaConfig');
const { avaliarCiclo } = require('../utils/cicloCobranca');
const { hojeSP } = require('../utils/dataSaoPaulo');

// Suspensão do Pix por taxa em atraso (SPEC §4: "suspende o Pix da empresa"; T8). Roda no backend de TENANT, nunca só no
// frontend. A suspensão é CALCULADA a cada tentativa de Pix, pela mesma regra do ciclo de cobrança (utils/cicloCobranca),
// a partir dos meses que o operador já FECHOU e dos pagamentos lançados:
//  * pagar reativa na hora (o saldo muda e a regra deixa de valer), sem estado velho nem rotina agendada;
//  * loja sem mês fechado, ou com tudo pago/abaixo do piso, nunca é suspensa;
//  * só atinge o Pix: dinheiro, cartão e crediário seguem (quem chama só consulta nas operações de Pix).
// Fica desligada até COBRANCA_SUSPENSAO_PIX=ligada no ambiente. Desligada, não faz nem uma consulta.

const MENSAGEM_PDV = 'O Pix está indisponível para esta empresa no momento. Use dinheiro, cartão ou crediário, ou fale com o administrador do sistema.';
const MENSAGEM_CLIENTE = 'O Pix está indisponível nesta loja no momento. Escolha outra forma de pagamento.';

// { suspenso, ... } da empresa ao dia `hoje`. `client` participa da transação de quem chama (a venda).
async function situacao(empresa_id, { client, hoje = hojeSP(), env = process.env } = {}) {
    const config = obterCicloCobranca(env);
    if (!config.suspensaoAtiva) return { ativa: false, suspenso: false };

    const linhas = await cobrancaTaxaRepository.periodosComSaldo({ empresa_id, client });
    const periodos = linhas.map((l) => ({ competencia: l.competencia, vencimento: l.vencimento, saldo: Number(l.saldo) }));
    const ciclo = avaliarCiclo({ periodos, hoje, config });

    return { ativa: true, suspenso: ciclo.suspender, desde: ciclo.suspensao_em };
}

// Recusa (403) quando a loja está com o Pix suspenso. A mensagem não cita taxa, valor nem motivo: taxa nunca aparece na API
// de vendas, e o caixa não é quem resolve a pendência (o administrador da loja é avisado pelo operador).
// `codigo` deixa a loja online trocar o texto por um próprio para a cliente.
async function exigirPixLiberado(empresa_id, opcoes = {}) {
    const { suspenso } = await situacao(empresa_id, opcoes);

    if (suspenso) {
        const erro = new AppError(MENSAGEM_PDV, 403);
        erro.codigo = 'PIX_SUSPENSO';
        throw erro;
    }
}

module.exports = { situacao, exigirPixLiberado, MENSAGEM_PDV, MENSAGEM_CLIENTE };
