const repository = require('../repositories/lojaGestaoRepository');
const AppError = require('../errors/AppError');
const response = require('../utils/response');
const { gestaoQuerySchema, entregaCombinadaSchema, UUID } = require('../validations/lojaValidation');

async function listar(req, res, next) {
    try {
        const q = gestaoQuerySchema.safeParse(req.query);

        if (!q.success) throw new AppError(q.error.issues[0].message, 400);

        const { itens, total } = await repository.listarPedidos({
            empresa_id: req.usuario.empresa_id, situacao: q.data.situacao, limit: q.data.limite, offset: (q.data.pagina - 1) * q.data.limite
        });

        // Tem dado pessoal da cliente: nunca em cache.
        res.set('Cache-Control', 'no-store');
        return response.success(res, { itens, total, pagina: q.data.pagina, limite: q.data.limite });
    } catch (error) { next(error); }
}

async function marcarEntregaCombinada(req, res, next) {
    try {
        const codigo = String(req.params.codigo ?? '');

        if (!UUID.test(codigo)) throw new AppError('Pedido não encontrado', 404);

        const corpo = entregaCombinadaSchema.safeParse(req.body ?? {});

        if (!corpo.success) throw new AppError(corpo.error.issues[0].message, 400);

        res.set('Cache-Control', 'no-store');
        return response.success(res, await repository.marcarEntregaCombinada({
            empresa_id: req.usuario.empresa_id, codigo: codigo.toLowerCase(), usuario_id: req.usuario.id, observacao: corpo.data.observacao
        }));
    } catch (error) { next(error); }
}

module.exports = { listar, marcarEntregaCombinada };
