const AppError = require('../errors/AppError');
const cargosRepository = require('../repositories/cargosRepository');
const { CATALOGO, CARGOS, CAPACIDADES, PERFIL_ADMIN } = require('../constants/cargos');
const { resolverCargo, temCapacidade } = require('./permissoesService');

const semAdministrador = (capacidades) => capacidades.filter((capacidade) => capacidade !== CAPACIDADES.ADMINISTRADOR);

function apresentar(cargo, linha) {
    const efetivo = resolverCargo(cargo, linha);
    const padrao = resolverCargo(cargo, null);
    const definicao = CATALOGO[cargo];

    return {
        cargo,
        rotulo: efetivo.rotulo,
        nivel: efetivo.nivel,
        ativo: efetivo.ativo,
        // `administrador` não é editável por aqui (fluxo próprio de /privilegios, com senha e auditoria):
        // aparece como campo à parte, e não dentro da lista que a tela reenvia no PUT.
        capacidades: semAdministrador(efetivo.capacidades),
        administrador: efetivo.administrador,
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

// Quem tem `gerir_cargos` sem ser Admin não pode se promover editando cargos: só mexe em cargos
// ABAIXO do seu nível, não define nível igual ou acima do seu e só concede capacidades que já tem.
function garantirSemEscalada(ator, definicao, atual, { nivel, capacidades }) {
    if (ator.role === PERFIL_ADMIN) return;

    const nivelDoAtor = ator.nivel ?? 0;

    if (definicao.escada) {
        if ((atual.nivel ?? 0) >= nivelDoAtor) {
            throw new AppError('Você só pode editar cargos abaixo do seu nível', 403);
        }

        if (nivel !== null && nivel >= nivelDoAtor) {
            throw new AppError('Você não pode definir um nível igual ou acima do seu', 403);
        }
    }

    const adicionadas = capacidades.filter((capacidade) => !atual.capacidades.includes(capacidade));

    if (adicionadas.some((capacidade) => !temCapacidade(ator, capacidade))) {
        throw new AppError('Você só pode conceder capacidades que você possui', 403);
    }
}

async function atualizar(empresaId, cargo, dados, ator) {
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
    const capacidadesEditaveis = dados.capacidades !== undefined ? dados.capacidades : semAdministrador(atual.capacidades);
    // O privilégio de Admin anexado ao cargo sobrevive à edição das demais capacidades.
    const capacidades = atual.administrador ? [...capacidadesEditaveis, CAPACIDADES.ADMINISTRADOR] : capacidadesEditaveis;

    garantirSemEscalada(ator, definicao, atual, { nivel, capacidades: capacidadesEditaveis });

    if (definicao.escada && nivel === null) {
        throw new AppError('Este cargo precisa de um nível', 400);
    }

    if (!definicao.escada && nivel !== null) {
        throw new AppError('Este cargo não participa da hierarquia: nível deve ser nulo', 400);
    }

    if (ativo === false && definicao.sempre_ativo) {
        throw new AppError('Este cargo básico não pode ser desativado', 409);
    }

    // Desligar um cargo com gente nele deixaria essas pessoas sem acesso: a checagem de uso e a
    // gravação acontecem juntas, sob a mesma trava de cargo que a criação de usuário respeita.
    await cargosRepository.salvarComTravaDeUso(
        { empresa_id: empresaId, cargo, nivel, ativo, capacidades, usuario_id: ator.id },
        { bloquearSeEmUso: ativo === false && atual.ativo }
    );

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
