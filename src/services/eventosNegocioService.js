const AppError = require('../errors/AppError');
const eventosRepository = require('../repositories/eventosNegocioRepository');
const { TIPOS_EVENTO } = require('../constants/eventosNegocio');

function validarEntrada(dados = {}) {
    const obrigatorios = ['empresa_id', 'tipo_evento', 'entidade_tipo', 'entidade_id'];
    for (const campo of obrigatorios) {
        if (dados[campo] === undefined || dados[campo] === null || dados[campo] === '') {
            throw new AppError(`Campo obrigatório: ${campo}`, 400);
        }
    }

    if (!Object.values(TIPOS_EVENTO).includes(dados.tipo_evento)) {
        throw new AppError('Tipo de evento de negócio inválido', 400);
    }

    if (!Number.isInteger(Number(dados.entidade_id)) || Number(dados.entidade_id) <= 0) {
        throw new AppError('entidade_id inválido', 400);
    }

    return {
        ...dados,
        entidade_id: Number(dados.entidade_id),
        payload: dados.payload ?? {}
    };
}

async function registrar(dados, clienteExterno) {
    return eventosRepository.criar(validarEntrada(dados), clienteExterno);
}

async function processarUm(id, empresa_id, handler, clienteExterno) {
    const evento = await eventosRepository.buscarPorId(id, empresa_id, clienteExterno);
    if (!evento) throw new AppError('Evento não encontrado', 404);
    if (evento.status === 'PROCESSADO') return evento;
    if (evento.status !== 'PENDENTE') {
        throw new AppError('Evento não está pendente para processamento', 409);
    }

    const reservado = await eventosRepository.marcarProcessando(id, empresa_id, clienteExterno);
    if (!reservado) {
        throw new AppError('Evento já está sendo processado ou não está pendente', 409);
    }

    try {
        await handler(reservado);
        return await eventosRepository.marcarProcessado(id, empresa_id, clienteExterno);
    } catch (error) {
        await eventosRepository.marcarErro(id, empresa_id, error.message, clienteExterno);
        throw error;
    }
}

module.exports = { registrar, processarUm, validarEntrada };
