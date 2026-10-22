const AppError = require('../errors/AppError');
const cargosRepository = require('../repositories/cargosRepository');
const { CATALOGO, CARGOS } = require('../constants/cargos');
const { resolverCargo } = require('./permissoesService');

function apresentar(cargo, linha) {
    const efetivo = resolverCargo(cargo, linha);
    const padrao = resolverCargo(cargo, null);
    const definicao = CATALOGO[cargo];

    return {
        cargo,
        rotulo: efetivo.rotulo,
        nivel: efetivo.nivel,
        ativo: efetivo.ativo,
        capacidades: efetivo.capacidades,
        em_escada: efetivo.escada,
        // Cargos básicos não se desligam; Admin não se edita.
        pode_desativar: !definicao.sempre_ativo,
        editavel: !definicao.imutavel,
        personalizado: Boolean(linha) && !definicao.imutavel,
        padrao: { nivel: padrao.nivel, ativo: padrao.ativo, capacidades: padrao.capacidades }
    };
}

async function listar(empresaId) {
    const linhas = await cargosRepository.listarPorEmpresa(empresaId);
    const porCargo = new Map(linhas.map((linha) => [linha.cargo, linha]));

    // Do mais alto para o mais baixo; cargos fora da escada no fim.
    return CARGOS
        .map((cargo) => apresentar(cargo, porCargo.get(cargo) ?? null))
        .sort((a, b) => (b.nivel ?? -1) - (a.nivel ?? -1));
}

async function atualizar(empresaId, cargo, dados, usuarioId) {
    const definicao = CATALOGO[cargo];

    if (!definicao) {
        throw new AppError('Cargo inválido', 400);
    }

    if (definicao.imutavel) {
        throw new AppError('O cargo Admin não pode ser alterado', 403);
    }

    const atual = resolverCargo(cargo, await cargosRepository.buscar(empresaId, cargo));

    const nivel = dados.nivel !== undefined ? dados.nivel : atual.nivel;
    const ativo = dados.ativo !== undefined ? dados.ativo : atual.ativo;
    const capacidades = dados.capacidades !== undefined ? dados.capacidades : atual.capacidades;

    if (definicao.escada && nivel === null) {
        throw new AppError('Este cargo precisa de um nível', 400);
    }

    if (!definicao.escada && nivel !== null) {
        throw new AppError('Este cargo não participa da hierarquia: nível deve ser nulo', 400);
    }

    if (ativo === false && definicao.sempre_ativo) {
        throw new AppError('Este cargo básico não pode ser desativado', 409);
    }

    // Desligar um cargo com gente nele deixaria essas pessoas sem acesso.
    if (ativo === false && atual.ativo) {
        const emUso = await cargosRepository.contarUsuariosAtivos(empresaId, cargo);

        if (emUso > 0) {
            throw new AppError(`Há ${emUso} usuário(s) ativo(s) neste cargo; mude o cargo deles antes de desativar`, 409);
        }
    }

    await cargosRepository.salvar({ empresa_id: empresaId, cargo, nivel, ativo, capacidades, usuario_id: usuarioId });

    return apresentar(cargo, { nivel, ativo, capacidades });
}

// Cadastro de usuário só em cargo ligado no comércio.
async function garantirCargoAtivo(empresaId, cargo) {
    if (!CATALOGO[cargo]) {
        throw new AppError('Papel inválido', 400);
    }

    const efetivo = resolverCargo(cargo, await cargosRepository.buscar(empresaId, cargo));

    if (!efetivo.ativo) {
        throw new AppError('Cargo não habilitado neste comércio', 409);
    }
}

module.exports = { listar, atualizar, garantirCargoAtivo };
