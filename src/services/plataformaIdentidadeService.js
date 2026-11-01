const repository = require('../repositories/empresasIdentidadeRepository');
const { TEMAS_VISUAIS } = require('../constants/temasVisuais');

async function listar() {
    return { temas: TEMAS_VISUAIS, empresas: await repository.listar() };
}

const historico = (empresa_id) => repository.historico(empresa_id);
const atualizar = (dados) => repository.atualizar(dados);

module.exports = { listar, historico, atualizar };
