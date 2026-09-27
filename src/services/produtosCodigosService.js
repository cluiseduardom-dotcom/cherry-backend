const produtosRepository = require('../repositories/produtosRepository');
const produtosCodigosRepository = require('../repositories/produtosCodigosRepository');
const AppError = require('../errors/AppError');

const TIPOS_COMERCIAIS = new Set(['EAN_8','EAN_13','EAN_14','UPC_A','GTIN_14']);
const TIPOS_VALIDOS = new Set([...TIPOS_COMERCIAIS, 'INTERNO', 'OUTRO']);

function normalizarCodigo(codigo) {
    return String(codigo ?? '').trim().replace(/[\\s-]/g, '');
}

function validarDigitoVerificador(codigo) {
    if (!/^\\d+$/.test(codigo)) return false;
    const digits = codigo.split('').map(Number);
    const check = digits.pop();
    let soma = 0;
    let peso = 3;
    for (let i = digits.length - 1; i >= 0; i--) {
        soma += digits[i] * peso;
        peso = peso === 3 ? 1 : 3;
    }
    return ((10 - (soma % 10)) % 10) === check;
}

function validarCodigo(codigo, tipo) {
    if (!TIPOS_VALIDOS.has(tipo)) throw new AppError('Tipo de código inválido', 400);

    if (TIPOS_COMERCIAIS.has(tipo)) {
        const tamanhos = {
            EAN_8: 8,
            EAN_13: 13,
            EAN_14: 14,
            UPC_A: 12,
            GTIN_14: 14
        };
        if (!/^\\d+$/.test(codigo) || codigo.length !== tamanhos[tipo]) {
            throw new AppError(`Código ${tipo} deve possuir ${tamanhos[tipo]} dígitos`, 400);
        }
        if (!validarDigitoVerificador(codigo)) {
            throw new AppError('Código de barras inválido: dígito verificador incorreto', 400);
        }
    } else if (codigo.length < 1 || codigo.length > 100) {
        throw new AppError('Código deve possuir entre 1 e 100 caracteres', 400);
    }
}

async function listarPorProduto(produtoId, empresaId) {
    const produto = await produtosRepository.buscarPorId(produtoId, empresaId);
    if (!produto) throw new AppError('Produto não encontrado', 404);
    return produtosCodigosRepository.listarPorProduto(produtoId, empresaId);
}

async function buscarPorCodigo(codigo, empresaId) {
    const normalizado = normalizarCodigo(codigo);
    if (!normalizado) throw new AppError('Código é obrigatório', 400);
    const resultado = await produtosCodigosRepository.buscarPorCodigo(normalizado, empresaId);
    if (!resultado) throw new AppError('Código de produto não encontrado', 404);
    return resultado;
}

async function adicionar(produtoId, dados, empresaId, usuarioId) {
    const produto = await produtosRepository.buscarPorId(produtoId, empresaId);
    if (!produto) throw new AppError('Produto não encontrado', 404);

    const tipo = dados.tipo ?? 'EAN_13';
    const codigo = TIPOS_COMERCIAIS.has(tipo) ? normalizarCodigoComercial(dados.codigo) : normalizarCodigo(dados.codigo);
    validarCodigo(codigo, tipo);

    try {
        return await produtosCodigosRepository.criar({
            empresaId,
            produtoId,
            codigo,
            tipo,
            principal: dados.principal ?? false,
            descricao: dados.descricao,
            usuarioId
        });
    } catch (error) {
        if (error.code === '23505') {
            throw new AppError('Código já cadastrado nesta empresa', 409);
        }
        throw error;
    }
}

async function remover(id, empresaId) {
    const removido = await produtosCodigosRepository.desativar(id, empresaId);
    if (!removido) throw new AppError('Código não encontrado', 404);
    return removido;
}

module.exports = { listarPorProduto, buscarPorCodigo, adicionar, remover };
