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

async function listarComSaldo(filtros, usuario) {
    return repository.listarComSaldo(usuario.empresa_id, filtros);
}

async function buscarComSaldo(id, usuario) {
    const conta = await repository.buscarComSaldo(id, usuario.empresa_id);
    if (!conta) throw new AppError('Conta bancária não encontrada', 404);
    return conta;
}

async function atualizarStatus(id, status, usuario) {
    if (!STATUS.has(status)) throw new AppError('Status da conta inválido', 400);
    const conta = await repository.atualizarStatus(id, usuario.empresa_id, status);
    if (!conta) throw new AppError('Conta bancária não encontrada', 404);
    return conta;
}

// O saldo inicial é a base de todo o saldo: depois que existe movimento ele não muda (o erro se corrige com
// movimento de ajuste), e em conta integrada ele vem do provedor, não é digitado.
async function atualizar(id, campos, usuario) {
    const conta = await repository.buscarPorId(id, usuario.empresa_id);
    if (!conta) throw new AppError('Conta bancária não encontrada', 404);

    const mexeNoSaldo = 'saldo_inicial' in campos || 'data_saldo_inicial' in campos;
    if (mexeNoSaldo) {
        if (conta.origem !== 'MANUAL') {
            throw new AppError('O saldo de uma conta integrada vem do provedor e não pode ser alterado', 400);
        }
        if (await repository.contarMovimentos(id, usuario.empresa_id) > 0) {
            throw new AppError('O saldo inicial não pode mudar depois que a conta tem movimentos. Lance um ajuste.', 409);
        }
    }

    if (campos.principal === true && conta.status === 'INATIVA') {
        throw new AppError('Conta inativa não pode ser principal', 400);
    }

    try {
        return await repository.atualizar(id, usuario.empresa_id, campos);
    } catch (erro) {
        if (erro.code === '23505') throw new AppError('Já existe uma conta principal. Tente de novo.', 409);
        throw erro;
    }
}

module.exports = { criar, buscarPorId, listar, listarComSaldo, buscarComSaldo, atualizarStatus, atualizar };
