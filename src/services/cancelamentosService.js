const bcrypt = require('bcrypt');
const AppError = require('../errors/AppError');
const vendasRepository = require('../repositories/vendasRepository');
const cancelamentosRepository = require('../repositories/cancelamentosRepository');
const cargosRepository = require('../repositories/cargosRepository');
const { faixaPorDias } = require('../constants/cancelamento');
const { CATALOGO } = require('../constants/cargos');
const { resolverCargo, aplicarConcessoes, podeVerVendasDeTodos } = require('./permissoesService');

// Cancelamento de venda com política por faixa (SPEC Cargos, Permissões e Cancelamento, §1.8):
//  - ≤ 7 dias: só o motivo; 8–30: senha de alguém de nível Supervisor ou acima; > 30: Gerente ou acima;
//  - "nível" é o do comércio (editável na tela de cargos); Admin (por cargo ou concedido) sempre qualifica;
//  - a senha do autorizador é digitada na hora, comparada com bcrypt e nunca guardada nem logada;
//  - a regra roda SEMPRE aqui, no servidor; a tela só a reflete (ver `previa`).

const HASH_DESCARTAVEL = bcrypt.hashSync('hash-descartavel-sem-usuario', 10);

const MENSAGEM_AUTORIZACAO_INVALIDA = 'Autorização inválida';

// Quem só enxerga as próprias vendas só cancela as próprias (mesma regra de vendasService).
const veSomenteAsProprias = (usuario) => usuario.role === 'vendedor' && !podeVerVendasDeTodos(usuario);

// Nível de referência da faixa NO COMÉRCIO. Se o cargo de referência estiver desligado, o nível
// configurado dele continua valendo como piso (SPEC §3).
async function nivelMinimoDaFaixa(faixa, empresaId) {
    const cargo = resolverCargo(faixa.cargo_minimo, await cargosRepository.buscar(empresaId, faixa.cargo_minimo));

    return { cargo: faixa.cargo_minimo, rotulo: CATALOGO[faixa.cargo_minimo].rotulo, nivel: cargo.nivel };
}

// Admin (pelo cargo ou concedido) qualifica sempre; senão, o cargo precisa estar ligado, fazer
// parte da escada e ter nível >= piso da faixa.
function qualificaComoAutorizador(candidato, nivelMinimo) {
    const linha = candidato.cargo_configurado
        ? { nivel: candidato.cargo_nivel, ativo: candidato.cargo_ativo, capacidades: candidato.cargo_capacidades }
        : null;

    const permissoes = aplicarConcessoes(resolverCargo(candidato.papel, linha), {
        administrador_concedido: candidato.administrador_concedido
    });

    if (!permissoes || !permissoes.ativo) return false;
    if (permissoes.administrador) return true;

    return permissoes.escada && permissoes.nivel >= nivelMinimo;
}

async function validarAutorizador(empresaId, faixa, autorizacao) {
    const nivelMinimo = await nivelMinimoDaFaixa(faixa, empresaId);

    if (!autorizacao) {
        throw new AppError(`Esta venda exige autorização de ${nivelMinimo.rotulo} ou superior`, 403);
    }

    const candidato = await cancelamentosRepository.buscarAutorizador(empresaId, autorizacao.email);

    // Sempre paga um bcrypt.compare e devolve a mesma mensagem, para não revelar se o e-mail
    // existe, se a senha errou ou se o cargo não basta.
    const senhaConfere = await bcrypt.compare(autorizacao.senha, candidato ? candidato.senha : HASH_DESCARTAVEL);

    if (!candidato || !candidato.ativo || !senhaConfere || !qualificaComoAutorizador(candidato, nivelMinimo.nivel)) {
        throw new AppError(MENSAGEM_AUTORIZACAO_INVALIDA, 403);
    }

    return { id: candidato.id, login: candidato.email };
}

async function carregarVenda(id, usuario) {
    const venda = await cancelamentosRepository.buscarIdadeDaVenda(id, usuario.empresa_id);

    // Vendedor não vê venda alheia: 404, como se não existisse.
    if (!venda || (veSomenteAsProprias(usuario) && venda.usuario_id !== usuario.id)) {
        throw new AppError('Venda não encontrada', 404);
    }

    return venda;
}

// O que a tela precisa para montar a janela de cancelamento SEM duplicar a regra: a faixa da venda,
// se pede autorização e de quem (cargo e nível no comércio). Não grava nada.
async function previa(id, usuario) {
    const venda = await carregarVenda(id, usuario);
    const faixa = faixaPorDias(venda.dias);

    const resposta = {
        venda_id: id,
        status: venda.status,
        dias_da_venda: venda.dias,
        faixa: faixa.codigo,
        exige_autorizacao: faixa.exige_autorizacao,
        autorizador_minimo: faixa.exige_autorizacao ? await nivelMinimoDaFaixa(faixa, usuario.empresa_id) : null,
        pode_cancelar: venda.status === 'finalizada'
    };

    if (!resposta.pode_cancelar) {
        resposta.motivo_bloqueio = 'Somente vendas finalizadas podem ser canceladas';
    }

    return resposta;
}

async function cancelar(id, usuario, { motivo, autorizacao }) {
    const venda = await carregarVenda(id, usuario);

    if (venda.status !== 'finalizada') {
        throw new AppError('Somente vendas finalizadas podem ser canceladas', 409);
    }

    const faixa = faixaPorDias(venda.dias);
    const autorizador = faixa.exige_autorizacao
        ? await validarAutorizador(usuario.empresa_id, faixa, autorizacao)
        : null;

    return vendasRepository.cancelar(id, usuario.id, usuario.empresa_id, {
        motivo,
        login: usuario.email,
        faixaAutorizada: faixa.codigo,
        autorizador,
        restringirAoUsuarioId: veSomenteAsProprias(usuario) ? usuario.id : null
    });
}

async function listar({ page, pageSize, ...filtros }, usuario) {
    const { items, total } = await cancelamentosRepository.listarPaginado(usuario.empresa_id, {
        ...filtros,
        limit: pageSize,
        offset: (page - 1) * pageSize
    });

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { previa, cancelar, listar };
