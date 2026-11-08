const repository = require('../repositories/lojaRepository');
const AppError = require('../errors/AppError');
const response = require('../utils/response');
const { SLUG_REGEX } = require('../constants/temasVisuais');
const { MINIMO_PECAS_MAIS_VENDIDOS, ITENS_POR_VITRINE } = require('../constants/loja');
const { catalogoQuerySchema, marcacaoSchema } = require('../validations/lojaValidation');

const NAO_ENCONTRADA = 'Loja não encontrada';
const SLUG_PRODUTO_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Cache curto: o estoque muda; o checkout sempre revalida de qualquer jeito.
function cachePublico(res) {
    res.set('Cache-Control', 'public, max-age=15');
}

// A empresa nunca vem do cliente como id: vem do slug público e é validada aqui (ativa + loja_online ligada).
// Slug malformado, inexistente, de empresa inativa ou sem a funcionalidade respondem o MESMO 404 (a rota não
// serve de sonda de empresas).
async function resolverEmpresa(req) {
    const slug = String(req.params.slug ?? '').toLowerCase();
    const empresa = SLUG_REGEX.test(slug) ? await repository.buscarEmpresaDaLoja(slug) : null;

    if (!empresa) throw new AppError(NAO_ENCONTRADA, 404);

    return empresa.empresa_id;
}

function lerQuery(schema, query) {
    const resultado = schema.safeParse(query);

    if (!resultado.success) throw new AppError(resultado.error.issues[0].message, 400);

    return resultado.data;
}

async function catalogo(req, res, next) {
    try {
        const empresa_id = await resolverEmpresa(req);
        const q = lerQuery(catalogoQuerySchema, req.query);
        const { total, itens } = await repository.listarCatalogo(empresa_id, { ...q, offset: (q.pagina - 1) * q.limite });

        cachePublico(res);
        return response.success(res, { itens, total, pagina: q.pagina, limite: q.limite });
    } catch (error) { next(error); }
}

async function produto(req, res, next) {
    try {
        const empresa_id = await resolverEmpresa(req);
        const slug = String(req.params.produtoSlug ?? '');
        const encontrado = SLUG_PRODUTO_REGEX.test(slug) && slug.length <= 160
            ? await repository.buscarProdutoPorSlug(empresa_id, slug)
            : null;

        if (!encontrado) throw new AppError('Produto não encontrado', 404);

        cachePublico(res);
        return response.success(res, encontrado);
    } catch (error) { next(error); }
}

async function categorias(req, res, next) {
    try {
        const empresa_id = await resolverEmpresa(req);

        cachePublico(res);
        return response.success(res, await repository.listarCategoriasComProdutos(empresa_id));
    } catch (error) { next(error); }
}

// Vitrines da página inicial. "Mais vendidos" vem vazio enquanto houver menos de N peças com venda (não se
// mostra um ranking de uma ou duas peças).
async function vitrines(req, res, next) {
    try {
        const empresa_id = await resolverEmpresa(req);
        const base = { limite: ITENS_POR_VITRINE, offset: 0 };

        const [novidades, comVenda] = await Promise.all([
            repository.listarCatalogo(empresa_id, { ...base, novidades: true, ordem: 'novidades' }),
            repository.contarComVenda(empresa_id)
        ]);

        const maisVendidos = comVenda >= MINIMO_PECAS_MAIS_VENDIDOS
            ? (await repository.listarCatalogo(empresa_id, { ...base, ordem: 'mais_vendidos', somenteComVenda: true })).itens
            : [];

        cachePublico(res);
        return response.success(res, { novidades: novidades.itens, mais_vendidos: maisVendidos });
    } catch (error) { next(error); }
}

// ---- Gestão (autenticado; empresa do JWT) ----

function parseId(value) {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido', 400);

    return id;
}

async function buscarMarcacao(req, res, next) {
    try {
        return response.success(res, await repository.buscarMarcacao(parseId(req.params.id), req.usuario.empresa_id));
    } catch (error) { next(error); }
}

async function salvarMarcacao(req, res, next) {
    try {
        const id = parseId(req.params.id);
        const dados = marcacaoSchema.safeParse(req.body ?? {});

        if (!dados.success) throw new AppError(dados.error.issues[0].message, 400);

        return response.success(res, await repository.salvarMarcacao(id, req.usuario.empresa_id, dados.data));
    } catch (error) { next(error); }
}

module.exports = { catalogo, produto, categorias, vitrines, buscarMarcacao, salvarMarcacao };
