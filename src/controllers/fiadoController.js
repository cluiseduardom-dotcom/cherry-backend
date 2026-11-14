const repository = require('../repositories/fiadoRepository');
const AppError = require('../errors/AppError');
const response = require('../utils/response');
const { temCapacidade } = require('../services/permissoesService');
const { CAPACIDADES } = require('../constants/cargos');
const { montarMensagemDeCobranca, linkWhatsApp } = require('../utils/fiadoCobranca');
const {
    compraSchema, pagamentoSchema, estornoSchema, clientesQuerySchema, extratoQuerySchema, resumoQuerySchema, CHAVE_IDEMPOTENCIA
} = require('../validations/fiadoValidation');

// Fiado (admin e equipe de vendas; a funcionalidade `fiado` é exigida em app.js). empresa_id e usuário vêm SEMPRE do JWT.
// Quem não tem `ver_todos_clientes` só enxerga os clientes que cadastrou (mesma regra de /clientes).
const escopoDe = (usuario) => (temCapacidade(usuario, CAPACIDADES.VER_TODOS_CLIENTES) ? undefined : usuario.id);

function parseId(valor) {
    const id = Number(valor);

    if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido', 400);

    return id;
}

function ler(schema, dados) {
    const resultado = schema.safeParse(dados ?? {});

    if (!resultado.success) throw new AppError(resultado.error.issues[0].message, 400);

    return resultado.data;
}

function chaveDeIdempotencia(req) {
    const chave = (req.get('Idempotency-Key') ?? '').trim();

    if (!CHAVE_IDEMPOTENCIA.test(chave)) {
        throw new AppError('Cabeçalho Idempotency-Key obrigatório (8 a 80 letras, números, hífen ou sublinhado)', 400);
    }

    return chave;
}

function enviar(res, resultado) {
    res.set('Cache-Control', 'no-store');

    if (resultado.reaproveitado) res.set('Idempotent-Replayed', 'true');

    return response.success(res, { lancamento: resultado.lancamento, saldo: resultado.saldo }, resultado.reaproveitado ? 200 : 201);
}

async function resumo(req, res, next) {
    try {
        const q = ler(resumoQuerySchema, req.query);

        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.resumo({ empresa_id: req.usuario.empresa_id, de: q.de ?? null, ate: q.ate ?? null, escopo: escopoDe(req.usuario) }));
    } catch (error) { next(error); }
}

async function clientes(req, res, next) {
    try {
        const q = ler(clientesQuerySchema, req.query);
        const { itens, total } = await repository.listarClientes({
            empresa_id: req.usuario.empresa_id, busca: q.busca || null, comSaldo: q.com_saldo === 'true',
            limit: q.pageSize, offset: (q.page - 1) * q.pageSize, escopo: escopoDe(req.usuario)
        });

        res.set('Cache-Control', 'no-store');
        return response.success(res, { itens, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
    } catch (error) { next(error); }
}

async function extrato(req, res, next) {
    try {
        const q = ler(extratoQuerySchema, req.query);

        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.extrato({
            empresa_id: req.usuario.empresa_id, cliente_id: parseId(req.params.id), limit: q.pageSize, offset: (q.page - 1) * q.pageSize, escopo: escopoDe(req.usuario)
        }));
    } catch (error) { next(error); }
}

async function compra(req, res, next) {
    try {
        const corpo = ler(compraSchema, req.body);
        const resultado = await repository.lancar({
            empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, cliente_id: parseId(req.params.id), tipo: 'compra',
            valor: corpo.valor, descricao: corpo.descricao, data: corpo.data ?? null, chave: chaveDeIdempotencia(req), escopo: escopoDe(req.usuario)
        });

        return enviar(res, resultado);
    } catch (error) { next(error); }
}

async function pagamento(req, res, next) {
    try {
        const corpo = ler(pagamentoSchema, req.body);
        const resultado = await repository.lancar({
            empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, cliente_id: parseId(req.params.id), tipo: 'pagamento',
            valor: corpo.valor, forma: corpo.forma ?? null, data: corpo.data ?? null, chave: chaveDeIdempotencia(req), escopo: escopoDe(req.usuario)
        });

        return enviar(res, resultado);
    } catch (error) { next(error); }
}

async function estorno(req, res, next) {
    try {
        const corpo = ler(estornoSchema, req.body);
        const resultado = await repository.estornar({
            empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, lancamento_id: parseId(req.params.id),
            motivo: corpo.motivo, chave: chaveDeIdempotencia(req), escopo: escopoDe(req.usuario)
        });

        return enviar(res, resultado);
    } catch (error) { next(error); }
}

// Mensagem de cobrança + link do WhatsApp. Só monta: quem envia é o comerciante.
async function cobranca(req, res, next) {
    try {
        const { cliente, saldo } = await repository.clienteComSaldo({ empresa_id: req.usuario.empresa_id, cliente_id: parseId(req.params.id), escopo: escopoDe(req.usuario) });

        if (!cliente.ativo || cliente.anonimizado) throw new AppError('Cliente inativo ou anonimizado', 409);
        if (saldo <= 0) throw new AppError('O cliente não tem saldo devedor', 422);

        const mensagem = montarMensagemDeCobranca({ nome: cliente.nome, saldo });
        const link = linkWhatsApp(cliente.telefone, mensagem);

        if (!link) throw new AppError('O cliente não tem um telefone válido cadastrado para o WhatsApp', 422);

        res.set('Cache-Control', 'no-store');
        return response.success(res, { saldo, mensagem, link_whatsapp: link });
    } catch (error) { next(error); }
}

module.exports = { resumo, clientes, extrato, compra, pagamento, estorno, cobranca };
