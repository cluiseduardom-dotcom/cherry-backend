'use strict';

// Aviso de cobrança da plataforma no sino do ERP (regra PURA, sem banco). Só para o ADMINISTRADOR da loja e só com a suspensão
// do Pix LIGADA (COBRANCA_SUSPENSAO_PIX=ligada): sem ela o aviso de suspensão seria falso. Aparece em duas situações, as que
// têm consequência de verdade: faltam até 5 dias para a suspensão ("aviso") ou o Pix já está suspenso. Antes disso, quem avisa
// é o operador da GiroNex (extrato e WhatsApp).
//
// Traz o VALOR da pendência (decisão do PO: o administrador precisa saber quanto deve) e a data; nunca percentual, taxa por
// venda nem detalhe de venda. É o único aviso do sino que fala de cobrança da plataforma: por isso só vai ao administrador.
const { somarDias } = require('./dataSaoPaulo');

const TIPO_COBRANCA = 'cobranca_plataforma';

const moeda = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
const dataBR = (iso) => iso.split('-').reverse().join('/');

// situacao: retorno de suspensaoPixService.situacao (`ativa`, `suspenso`, `ciclo`); perfil: { administrador }.
function montarNotificacoesCobranca(situacao, perfil) {
    if (!perfil?.administrador || !situacao?.ativa || !situacao.ciclo) return [];

    const { ciclo } = situacao;
    const valor = moeda(ciclo.saldo_vencido);
    const acao = 'Falar com a GiroNex para regularizar o pagamento.';
    const base = { tipo: TIPO_COBRANCA, prioridade: 'alta', produto_id: null, sku: null, nome: null, item: 'cobranca', acao };

    // O id carrega o início da suspensão: um episódio novo volta como "novo" mesmo que o anterior tenha sido marcado como lido.
    if (situacao.suspenso) {
        return [{
            ...base,
            id: `${TIPO_COBRANCA}:suspenso:${ciclo.suspensao_em}`,
            titulo: 'Pix da loja suspenso',
            mensagem: `O Pix da loja está suspenso por uma pendência de ${valor} com a GiroNex. Dinheiro e cartão seguem normais. O Pix volta assim que o pagamento for registrado.`,
            dados: { saldo_vencido: ciclo.saldo_vencido, suspensao_em: ciclo.suspensao_em }
        }];
    }

    if (ciclo.estagio === 'aviso_suspensao' && ciclo.suspensao_em) {
        return [{
            ...base,
            id: `${TIPO_COBRANCA}:aviso:${ciclo.suspensao_em}`,
            titulo: 'Pix da loja será suspenso',
            mensagem: `Há uma pendência de ${valor} com a GiroNex. Se não for paga até ${dataBR(somarDias(ciclo.suspensao_em, -1))}, o Pix da loja será suspenso. Dinheiro e cartão seguem normais.`,
            dados: { saldo_vencido: ciclo.saldo_vencido, suspensao_em: ciclo.suspensao_em }
        }];
    }

    return [];
}

module.exports = { montarNotificacoesCobranca, TIPO_COBRANCA };
