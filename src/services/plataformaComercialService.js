const plataformaComercialRepository = require('../repositories/plataformaComercialRepository');
const taxasPlataformaRepository = require('../repositories/taxasPlataformaRepository');
const db = require('../config/db');

async function listarPlanos() {
    const linhas = await plataformaComercialRepository.listarPlanos();

    return linhas.map((linha) => ({
        codigo: linha.codigo,
        nome: linha.nome,
        tem_mensalidade: linha.tem_mensalidade,
        ativo: linha.ativo,
        percentual: linha.percentual === null ? null : Number(linha.percentual)
    }));
}

// A regra efetiva vem do MESMO resolvedor usado na venda (condição individual > plano > padrão),
// para a tela nunca divergir do que será cobrado. Se a empresa estiver com configuração inválida
// (ex.: plano sem política vigente), a linha mostra o erro em vez de derrubar a lista.
async function regraEfetiva(empresa_id) {
    try {
        const regra = await taxasPlataformaRepository.resolverRegra(empresa_id, db);
        return { percentual: Number(regra.percentual), origem: regra.origem, erro: null };
    } catch (error) {
        return { percentual: null, origem: null, erro: error.message };
    }
}

async function listarEmpresas() {
    const linhas = await plataformaComercialRepository.listarEmpresas();

    return Promise.all(linhas.map(async (linha) => ({
        empresa_id: linha.empresa_id,
        empresa_nome: linha.empresa_nome,
        status: linha.status,
        plano: linha.plano_codigo
            ? {
                codigo: linha.plano_codigo,
                nome: linha.plano_nome,
                tem_mensalidade: linha.tem_mensalidade,
                vigencia_inicio: linha.plano_inicio,
                vigencia_fim: linha.plano_fim
            }
            : null,
        condicao: linha.condicao_id
            ? {
                id: linha.condicao_id,
                percentual: Number(linha.condicao_percentual),
                vigencia_inicio: linha.condicao_inicio,
                vigencia_fim: linha.condicao_fim,
                justificativa: linha.condicao_justificativa,
                responsavel: linha.condicao_responsavel
            }
            : null,
        regra_efetiva: await regraEfetiva(linha.empresa_id)
    })));
}

const historico = (empresa_id) => plataformaComercialRepository.historico(empresa_id);
const trocarPlano = (dados) => plataformaComercialRepository.trocarPlano(dados);
const definirCondicao = (dados) => plataformaComercialRepository.definirCondicao(dados);
const encerrarCondicao = (dados) => plataformaComercialRepository.encerrarCondicao(dados);

module.exports = {
    listarPlanos,
    listarEmpresas,
    historico,
    trocarPlano,
    definirCondicao,
    encerrarCondicao
};
