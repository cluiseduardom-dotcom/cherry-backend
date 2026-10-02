const AppError = require('../errors/AppError');
const repository = require('../repositories/contasBancariasRepository');

const TIPOS = new Set(['CAIXA','CONTA_CORRENTE','CONTA_POUPANCA','CONTA_PAGAMENTO']);
const ORIGENS = new Set(['MANUAL','OPEN_FINANCE','API_BANCO']);
const STATUS = new Set(['ATIVA','BLOQUEADA','INATIVA']);

function validarTexto(valor, mensagem) {
    if (!valor || !String(valor).trim()) throw new AppError(mensagem, 400);
}

function validarNumero(valor, mensagem) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) throw new AppError(mensagem, 400);
    return numero;
}

async function criar(dados, usuario) {
    validarTexto(dados.nome, 'Nome da conta é obrigatório');

    if (!TIPOS.has(dados.tipo)) {
        throw new AppError('Tipo de conta inválido', 400);
    }

    const origem = dados.origem ?? 'MANUAL';
    if (!ORIGENS.has(origem)) {
        throw new AppError('Origem da conta inválida', 400);
    }

    const status = dados.status ?? 'ATIVA';
    if (!STATUS.has(status)) {
        throw new AppError('Status da conta inválido', 400);
    }

    const saldoInicial = validarNumero(
        dados.saldo_inicial ?? 0,
        'Saldo inicial inválido'
    );

    if (dados.principal === true && status === 'INATIVA') {
        throw new AppError('Conta inativa não pode ser principal', 400);
    }

    if (origem !== 'MANUAL' && !dados.provedor) {
        throw new AppError('Provedor é obrigatório para conta integrada', 400);
    }

    return repository.criar({
        ...dados,
        empresa_id: usuario.empresa_id,
        origem,
        status,
        saldo_inicial: saldoInicial,
        usuario_id: usuario.id ?? dados.usuario_id ?? null
    });
}

async function buscarPorId(id, usuario) {
    return repository.buscarPorId(id, usuario.empresa_id);
}

async function listar(filtros, usuario) {
    return repository.listar(usuario.empresa_id, filtros);
}

async function atualizarStatus(id, status, usuario) {
    if (!STATUS.has(status)) throw new AppError('Status da conta inválido', 400);
    return repository.atualizarStatus(id, usuario.empresa_id, status);
}

module.exports = { criar, buscarPorId, listar, atualizarStatus };
