const AppError = require('../errors/AppError');
const repository = require('../repositories/conciliacaoBancariaRepository');
const movimentosRepo = require('../repositories/movimentosBancariosRepository');

async function conciliar(dados, usuario) {
    const movimentoId = Number(dados.movimento_bancario_id);
    if (!Number.isInteger(movimentoId) || movimentoId <= 0) throw new AppError('Movimento bancário inválido', 400);

    const movimento = await movimentosRepo.buscarPorId(movimentoId, usuario.empresa_id);
    if (!movimento) throw new AppError('Movimento bancário não encontrado', 404);
    if (movimento.cancelado_em) throw new AppError('Movimento cancelado não se concilia', 400);
    if (movimento.conciliado) throw new AppError('Movimento já conciliado', 400);

    if (dados.valor_externo != null && (!Number.isFinite(Number(dados.valor_externo)) || Number(dados.valor_externo) <= 0)) {
        throw new AppError('Valor externo inválido', 400);
    }

    // Marca o movimento e cria a conciliação na mesma instrução; quem perder a corrida recebe 409.
    const conciliacao = await repository.conciliarAtomico({ ...dados, empresa_id: usuario.empresa_id, usuario_id: usuario.id ?? null });
    if (!conciliacao) throw new AppError('Movimento já conciliado ou cancelado', 409);
    return conciliacao;
}

async function listar(filtros, usuario) {
    return repository.listar(usuario.empresa_id, filtros);
}

async function desfazer(id, usuario) {
    const atual = await repository.buscarPorId(Number(id), usuario.empresa_id);
    if (!atual) throw new AppError('Conciliação não encontrada', 404);
    const desfeita = await repository.desfazerAtomico(Number(id), usuario.empresa_id);
    if (!desfeita) throw new AppError('Conciliação já estava desfeita', 409);
    return desfeita;
}

module.exports = { conciliar, listar, desfazer };
