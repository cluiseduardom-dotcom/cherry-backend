const clientesRepository = require('../repositories/clientesRepository');
const AppError = require('../errors/AppError');
const { temCapacidade } = require('./permissoesService');
const { CAPACIDADES } = require('../constants/cargos');

// Quem tem `ver_todos_clientes` (Admin tem todas) enxerga todos os clientes da empresa; os demais, só os que
// cadastraram. Devolve o id a filtrar (usuário do JWT) ou undefined = sem restrição. A empresa é sempre filtrada.
function escopoDeClientes(usuario) {
    return temCapacidade(usuario, CAPACIDADES.VER_TODOS_CLIENTES) ? undefined : usuario.id;
}

async function listar(usuario) {
    return clientesRepository.listar(usuario.empresa_id, escopoDeClientes(usuario));
}

// O responsável é sempre o usuário do JWT, nunca um campo do corpo.
async function criar(dados, usuario) {
    return clientesRepository.criar({ ...dados, empresa_id: usuario.empresa_id, criado_por: usuario.id });
}

async function atualizar(id, dados, usuario) {
    const escopo = escopoDeClientes(usuario);
    const cliente = await clientesRepository.buscarPorId(id, usuario.empresa_id, escopo);

    if (!cliente) {
        throw new AppError('Cliente não encontrado', 404);
    }

    const atualizado = await clientesRepository.atualizar(id, dados, usuario.empresa_id, escopo);

    if (!atualizado) {
        throw new AppError('Cliente não encontrado', 404);
    }

    return atualizado;
}

async function historico(id, usuario) {
    const registros = await clientesRepository.getHistorico(id, usuario.empresa_id, escopoDeClientes(usuario));

    if (registros.length === 0) {
        throw new AppError('Nenhum histórico encontrado', 404);
    }

    return registros;
}

async function ranking(usuario) {
    return clientesRepository.getRanking(usuario.empresa_id, escopoDeClientes(usuario));
}

async function totalGasto(id, usuario) {
    const dados = await clientesRepository.getTotalGasto(id, usuario.empresa_id, escopoDeClientes(usuario));

    if (!dados) {
        throw new AppError('Cliente não encontrado', 404);
    }

    return dados;
}

async function anonimizar(id, empresaId) {
    const cliente = await clientesRepository.anonimizar(id, empresaId);

    return {
        id: cliente.id,
        anonimizado: cliente.anonimizado,
        anonimizado_em: cliente.anonimizado_em
    };
}

module.exports = {
    escopoDeClientes,
    listar,
    criar,
    atualizar,
    historico,
    ranking,
    totalGasto,
    anonimizar
};
