const configuracoesFinanceirasRepository = require('../repositories/configuracoesFinanceirasRepository');

async function obter(empresaId) {
    return configuracoesFinanceirasRepository.obterOuCriar(empresaId);
}

async function atualizar(empresaId, aliquotaImposto) {
    return configuracoesFinanceirasRepository.atualizar(empresaId, aliquotaImposto);
}

module.exports = {
    obter,
    atualizar
};
