const repository = require('../repositories/lojaRepository');
const pedidosRepository = require('../repositories/lojaPedidosRepository');
const AppError = require('../errors/AppError');
const response = require('../utils/response');
const { SLUG_REGEX } = require('../constants/temasVisuais');
const { MINIMO_PECAS_MAIS_VENDIDOS, ITENS_POR_VITRINE } = require('../constants/loja');
const lojaPagamentoService = require('../services/lojaPagamentoService');
const { exigirVerificacao } = require('../integrations/turnstileClient');
const { catalogoQuerySchema, marcacaoSchema, pedidoSchema, pagamentoSchema, hashDoPedido, CHAVE_IDEMPOTENCIA, UUID } = require('../validations/lojaValidation');

const retratosRepository = require('../repositories/lojaRetratosRepository');
const storage = require('../services/storage/imagensStorage');

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

        const [novidades, comVenda, carrossel] = await Promise.all([
            repository.listarCatalogo(empresa_id, { ...base, novidades: true, ordem: 'novidades' }),
            repository.contarComVenda(empresa_id),
            // O carrossel é um complemento: se falhar (ex.: migration 099 ainda não aplicada), a Home continua com as vitrines.
            repository.listarCarrosselNovidades(empresa_id).catch((erro) => {
                console.error('[loja] carrossel de novidades indisponível:', erro.message);
                return [];
            })
        ]);

        const maisVendidos = comVenda >= MINIMO_PECAS_MAIS_VENDIDOS
            ? (await repository.listarCatalogo(empresa_id, { ...base, ordem: 'mais_vendidos', somenteComVenda: true })).itens
            : [];

        cachePublico(res);
        return response.success(res, { novidades: novidades.itens, mais_vendidos: maisVendidos, carrossel });
    } catch (error) { next(error); }
}

// Retratos da abertura da Home: só os ativos COM autorização de uso de imagem registrada (a regra está na consulta).
async function retratos(req, res, next) {
    try {
        const empresa_id = await resolverEmpresa(req);
        const lista = await retratosRepository.listarPublicos(empresa_id);

        res.set('Cache-Control', 'public, max-age=60');
        return response.success(res, lista
            .map((r) => ({ url: storage.urlPublica(r.chave), alt: r.alt, nome: r.nome }))
            .filter((r) => r.url));
    } catch (error) { next(error); }
}

// ---- Pedido do visitante ----

// Libera reservas vencidas antes de ler ou criar pedido, para a disponibilidade e o status estarem em dia mesmo
// sem o cron. Falha aqui nunca derruba a requisição da cliente (o cron do Render também varre).
async function varrerVencidos(filtro) {
    try {
        await pedidosRepository.expirarVencidos(filtro);
    } catch (error) {
        console.error('Falha ao liberar reservas vencidas da loja:', error.message);
    }
}

// Erro de negócio com detalhes (ex.: quais itens mudaram) sai direto, com `codigo` e `detalhes`; o errorHandler
// global só devolve a mensagem.
function responderRecusa(res, error) {
    return res.status(error.statusCode).json({ success: false, message: error.message, codigo: error.codigo, ...(error.detalhes ? { detalhes: error.detalhes } : {}) });
}

async function criarPedido(req, res, next) {
    try {
        const empresa_id = await resolverEmpresa(req);
        const chave = req.get('Idempotency-Key') ?? '';

        if (!CHAVE_IDEMPOTENCIA.test(chave)) {
            throw new AppError('Cabeçalho Idempotency-Key obrigatório (8 a 80 letras, números, hífen ou sublinhado)', 400);
        }

        const dados = pedidoSchema.safeParse(req.body ?? {});

        if (!dados.success) throw new AppError(dados.error.issues[0].message, 400);

        const hash = hashDoPedido(dados.data);

        // Retry de um pedido que já existe: devolve sem exigir outra verificação (o token é de uso único).
        const existente = await pedidosRepository.buscarReaproveitavel(empresa_id, chave, hash);

        if (existente) {
            res.set('Cache-Control', 'no-store');
            res.set('Idempotent-Replayed', 'true');
            return response.success(res, existente, 200);
        }

        // Anti-robô ANTES de reservar qualquer peça: é o que impede reserva em massa.
        await exigirVerificacao({ token: dados.data.captcha_token, ip: req.ip });

        await varrerVencidos({ empresa_id, limite: 10 });

        const { pedido, reaproveitado } = await pedidosRepository.criarPedido({
            empresa_id, chave, hash, cliente: dados.data.cliente, itens: dados.data.itens
        });

        res.set('Cache-Control', 'no-store');
        if (reaproveitado) res.set('Idempotent-Replayed', 'true');

        return response.success(res, pedido, reaproveitado ? 200 : 201);
    } catch (error) {
        if (error.codigo && error.statusCode) return responderRecusa(res, error);
        next(error);
    }
}

async function buscarPedido(req, res, next) {
    try {
        const empresa_id = await resolverEmpresa(req);
        const codigo = String(req.params.codigo ?? '');
        let pedido = null;

        if (UUID.test(codigo)) {
            await varrerVencidos({ empresa_id, codigo, limite: 1 });
            pedido = await pedidosRepository.buscarPedidoPublico(empresa_id, codigo.toLowerCase());
        }

        // Código inexistente, malformado ou de outra loja: o mesmo 404.
        if (!pedido) throw new AppError('Pedido não encontrado', 404);

        res.set('Cache-Control', 'no-store');
        return response.success(res, pedido);
    } catch (error) { next(error); }
}

// Gera o Pix ou o link de cartão do pedido. Idempotente: a mesma cobrança volta enquanto estiver em aberto.
// A cliente não aprova nada aqui: o pedido só vira pago pelo webhook validado do Mercado Pago.
async function criarPagamento(req, res, next) {
    try {
        const empresa_id = await resolverEmpresa(req);
        const codigoPedido = String(req.params.codigo ?? '');

        if (!UUID.test(codigoPedido)) throw new AppError('Pedido não encontrado', 404);

        const dados = pagamentoSchema.safeParse(req.body ?? {});

        if (!dados.success) throw new AppError(dados.error.issues[0].message, 400);

        const { pagamento, criado } = await lojaPagamentoService.iniciarPagamento({
            empresa_id, codigoPedido: codigoPedido.toLowerCase(), metodo: dados.data.metodo
        });

        res.set('Cache-Control', 'no-store');
        return response.success(res, pagamento, criado ? 201 : 200);
    } catch (error) {
        if (error.codigo && error.statusCode) return responderRecusa(res, error);
        next(error);
    }
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

module.exports = { catalogo, produto, categorias, vitrines, retratos, criarPedido, buscarPedido, criarPagamento, buscarMarcacao, salvarMarcacao };
