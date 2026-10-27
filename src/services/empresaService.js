const empresaRepository = require('../repositories/empresaRepository');
const AppError = require('../errors/AppError');

async function obterDados(empresaId) {
    const dados = await empresaRepository.obterDados(empresaId);

    if (!dados) throw new AppError('Empresa não encontrada', 404);

    return dados;
}

async function atualizarDados(empresaId, dados, usuarioId) {
    // `nome` é NOT NULL: nunca limpar.
    if (dados.nome === null) throw new AppError('Nome é obrigatório', 400);

    const atualizada = await empresaRepository.atualizarDados(empresaId, dados, usuarioId);

    if (!atualizada) throw new AppError('Empresa não encontrada', 404);

    return atualizada;
}

module.exports = { obterDados, atualizarDados };
