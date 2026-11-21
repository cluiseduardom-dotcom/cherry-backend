const AppError = require('../errors/AppError');
const gradesRepository = require('../repositories/gradesRepository');
const categoriasRepository = require('../repositories/categoriasRepository');
const produtosService = require('./produtosService');
const { podeVerCustos } = require('./permissoesService');

// Grade de produtos: a "camiseta" que existe em vários tamanhos e cores. Cada variação é um produto normal
// (SKU, estoque, preço próprios) ligado à grade. Custo só sai para quem pode ver custos; para os demais é omitido.

const num = (valor) => (valor === null || valor === undefined ? null : Number(valor));
const unico = (lista) => [...new Set(lista)];

// Confere os valores de uma variação contra os eixos: exatamente os eixos, cada valor um texto de 1 a 40 caracteres.
function normalizarValores(eixos, valores) {
    const chaves = Object.keys(valores);

    if (chaves.length !== eixos.length || eixos.some((e) => !(e in valores))) {
        throw new AppError(`Cada variação deve informar exatamente: ${eixos.join(', ')}`, 400);
    }

    const resultado = {};

    for (const eixo of eixos) {
        const valor = valores[eixo];

        if (typeof valor !== 'string' || !valor.trim()) throw new AppError(`Informe o valor de "${eixo}" em todas as variações`, 400);
        if (valor.trim().length > 40) throw new AppError(`O valor de "${eixo}" deve ter até 40 caracteres`, 400);

        resultado[eixo] = valor.trim();
    }

    return resultado;
}

const chaveDaCombinacao = (eixos, valores) => JSON.stringify(eixos.map((e) => valores[e].toLowerCase()));

function prepararVariacoes(nomeGrade, eixos, variacoes) {
    const vistas = new Set();

    return variacoes.map((v) => {
        const valores = normalizarValores(eixos, v.valores);
        const chave = chaveDaCombinacao(eixos, valores);

        if (vistas.has(chave)) throw new AppError('Há variações repetidas (mesma combinação de valores)', 400);
        vistas.add(chave);

        return {
            valores,
            nome: `${nomeGrade} ${eixos.map((e) => valores[e]).join(' / ')}`.slice(0, 255),
            custo: v.custo,
            categoria_ids: v.categoria_ids ?? []
        };
    });
}

// Antes de criar qualquer coisa: toda categoria existe na empresa, é de produto e não há dois níveis iguais por variação.
async function validarCategorias(empresaId, comuns, variacoes) {
    const todos = unico([...comuns, ...variacoes.flatMap((v) => v.categoria_ids)]);

    if (!todos.length) return;

    const categorias = await categoriasRepository.buscarPorIds(todos, empresaId);

    if (categorias.length !== todos.length) throw new AppError('Categoria inválida', 400);
    if (categorias.some((c) => (c.escopo ?? 'produto') !== 'produto')) throw new AppError('Produtos só aceitam categorias de produto', 400);

    const nivelDe = new Map(categorias.map((c) => [c.id, c.nivel]));

    for (const v of variacoes) {
        const niveis = unico([...comuns, ...v.categoria_ids]).map((id) => nivelDe.get(id));

        if (new Set(niveis).size !== niveis.length) throw new AppError('Não é permitido mais de uma categoria do mesmo nível', 400);
    }
}

// Gera o SKU pelo caminho de sempre (cada categorização é uma transação própria). Falha aqui não desfaz a grade:
// a variação fica sem SKU, como qualquer produto sem categoria, e a resposta avisa.
async function gerarSkus(criadas, preparadas, comuns, usuario) {
    const resultado = [];

    for (const [indice, produto] of criadas.entries()) {
        const categoriaIds = unico([...comuns, ...preparadas[indice].categoria_ids]);
        let sku = produto.sku ?? null;
        let aviso;

        if (categoriaIds.length) {
            try {
                const categorizado = await produtosService.categorizar(produto.id, categoriaIds, usuario.empresa_id, usuario.id);

                sku = categorizado.sku ?? null;
            } catch (error) {
                aviso = `Variação criada sem SKU: ${error.message}`;
            }
        }

        resultado.push({ ...apresentarVariacao({ ...produto, sku }, true), ...(aviso ? { aviso } : {}) });
    }

    return resultado;
}

function apresentarVariacao(p, verCustos) {
    const base = {
        id: p.id,
        sku: p.sku ?? null,
        nome: p.nome,
        variacao: p.variacao,
        estoque_atual: p.estoque_atual,
        estoque_minimo: p.estoque_minimo,
        preco_venda: num(p.preco_venda),
        unidade: p.unidade,
        ativo: p.ativo
    };

    return verCustos ? { ...base, custo: num(p.custo) } : base;
}

function apresentarGrade(g, verCustos) {
    const base = { id: g.id, nome: g.nome, descricao: g.descricao ?? null, eixos: g.eixos, unidade: g.unidade, estoque_minimo: g.estoque_minimo, preco_venda: num(g.preco_venda) };

    return verCustos ? { ...base, custo: num(g.custo) } : base;
}

async function criar(dados, usuario) {
    const verCustos = podeVerCustos(usuario);
    const eixos = dados.eixos;
    const comuns = unico(dados.categoria_ids ?? []);
    const preparadas = prepararVariacoes(dados.nome, eixos, dados.variacoes);

    await validarCategorias(usuario.empresa_id, comuns, preparadas);

    const { grade, variacoes } = await gradesRepository.criar({
        empresa_id: usuario.empresa_id,
        usuario_id: usuario.id,
        grade: { ...dados, categorias_comuns: comuns },
        variacoes: preparadas
    });
    const comSku = await gerarSkus(variacoes, preparadas, comuns, usuario);

    return { grade: apresentarGrade(grade, verCustos), variacoes: verCustos ? comSku : comSku.map(({ custo, ...resto }) => resto) };
}

async function acrescentar(gradeId, dados, usuario) {
    const verCustos = podeVerCustos(usuario);
    const existente = await gradesRepository.buscarPorId(gradeId, usuario.empresa_id);

    if (!existente) throw new AppError('Grade não encontrada', 404);

    const comuns = unico(existente.grade.categorias_comuns ?? []);
    const preparadas = prepararVariacoes(existente.grade.nome, existente.grade.eixos, dados.variacoes);

    await validarCategorias(usuario.empresa_id, comuns, preparadas);

    const { grade, variacoes } = await gradesRepository.acrescentar({ grade_id: gradeId, empresa_id: usuario.empresa_id, variacoes: preparadas });
    const comSku = await gerarSkus(variacoes, preparadas, comuns, usuario);

    return { grade: apresentarGrade(grade, verCustos), variacoes: verCustos ? comSku : comSku.map(({ custo, ...resto }) => resto) };
}

async function listar({ page, pageSize }, usuario) {
    const { items, total } = await gradesRepository.listarPaginado({ limit: pageSize, offset: (page - 1) * pageSize, empresa_id: usuario.empresa_id });

    return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function buscarPorId(id, usuario) {
    const encontrada = await gradesRepository.buscarPorId(id, usuario.empresa_id);

    if (!encontrada) throw new AppError('Grade não encontrada', 404);

    const verCustos = podeVerCustos(usuario);

    return {
        grade: apresentarGrade(encontrada.grade, verCustos),
        variacoes: encontrada.variacoes.map((p) => apresentarVariacao(p, verCustos))
    };
}

async function atualizar(id, dados, usuario) {
    const atualizada = await gradesRepository.atualizar(id, dados, usuario.empresa_id);

    if (!atualizada) throw new AppError('Grade não encontrada', 404);

    return buscarPorId(id, usuario);
}

module.exports = { criar, acrescentar, listar, buscarPorId, atualizar };
