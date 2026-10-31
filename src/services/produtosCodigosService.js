const produtosRepository = require('../repositories/produtosRepository');
const produtosCodigosRepository = require('../repositories/produtosCodigosRepository');
const AppError = require('../errors/AppError');

const TIPOS_COMERCIAIS = new Set(['EAN_8','EAN_13','EAN_14','UPC_A','GTIN_14']);
const TIPOS_VALIDOS = new Set([...TIPOS_COMERCIAIS, 'INTERNO', 'OUTRO']);

function normalizarCodigo(codigo) {
    return String(codigo ?? '').trim();
}

function normalizarCodigoComercial(codigo) {
    return normalizarCodigo(codigo).replace(/[\s-]/g, '');
}

function validarDigitoVerificador(codigo) {
    if (!/^\d+$/.test(codigo)) return false;
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
        if (!/^\d+$/.test(codigo) || codigo.length !== tamanhos[tipo]) {
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

const LIMITE_ETIQUETAS_POR_PEDIDO = 200;

// Códigos internos candidatos, do mais curto ao mais longo: o curto cabe em etiqueta pequena (Code 128 em
// dígitos usa 2 por símbolo). Nunca é EAN: EAN oficial exige a GS1; se a loja contratar depois, o EAN entra como
// principal e este continua ativo (as etiquetas já coladas seguem lendo).
function candidatosCodigoInterno(produtoId) {
    return [String(produtoId).padStart(6, '0'), `I${String(produtoId).padStart(8, '0')}`];
}

function primeiroCodigoPorProduto(linhas) {
    const mapa = new Map();

    for (const linha of linhas) {
        if (!mapa.has(linha.produto_id)) mapa.set(linha.produto_id, linha);
    }

    return mapa;
}

// Garante um código por produto para imprimir etiqueta e devolve o código a usar. Idempotente: quem já tem
// código ativo (principal primeiro) mantém o dele; só quem não tem recebe um INTERNO novo. Código por PRODUTO
// (todas as peças iguais leem o mesmo código); empresa vem do JWT.
async function garantirCodigosParaEtiqueta(produtoIds, empresaId, usuarioId) {
    if (!Array.isArray(produtoIds) || produtoIds.length === 0) throw new AppError('Informe ao menos um produto', 400);

    const ids = [...new Set(produtoIds)];

    if (ids.length > LIMITE_ETIQUETAS_POR_PEDIDO) throw new AppError(`Máximo de ${LIMITE_ETIQUETAS_POR_PEDIDO} produtos por pedido`, 400);
    if (!ids.every((id) => Number.isInteger(id) && id > 0)) throw new AppError('ID de produto inválido', 400);

    const daEmpresa = await produtosCodigosRepository.idsDeProdutosDaEmpresa(ids, empresaId);

    if (daEmpresa.length !== ids.length) throw new AppError('Produto não encontrado', 404);

    const existentes = primeiroCodigoPorProduto(await produtosCodigosRepository.listarAtivosDeProdutos(ids, empresaId));
    const resultado = [];

    for (const produtoId of ids) {
        let atual = existentes.get(produtoId);

        if (!atual) {
            for (const candidato of candidatosCodigoInterno(produtoId)) {
                try {
                    const criado = await produtosCodigosRepository.criar({
                        empresaId, produtoId, codigo: candidato, tipo: 'INTERNO', principal: true,
                        descricao: 'Código interno (etiqueta)', usuarioId
                    });

                    atual = criado;
                    break;
                } catch (error) {
                    if (error.code !== '23505') throw error;

                    // Corrida (outro pedido criou agora) ou código já usado por outro produto: relê antes de tentar o próximo.
                    const relido = primeiroCodigoPorProduto(await produtosCodigosRepository.listarAtivosDeProdutos([produtoId], empresaId)).get(produtoId);

                    if (relido) {
                        atual = relido;
                        break;
                    }
                }
            }
        }

        if (!atual) throw new AppError('Não foi possível gerar o código do produto', 409);

        resultado.push({ produto_id: produtoId, codigo: atual.codigo, tipo: atual.tipo });
    }

    return resultado;
}

module.exports = { listarPorProduto, buscarPorCodigo, adicionar, remover, garantirCodigosParaEtiqueta, LIMITE_ETIQUETAS_POR_PEDIDO };
