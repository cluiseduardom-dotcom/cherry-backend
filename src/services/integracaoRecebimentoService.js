const db = require('../config/db');
const AppError = require('../errors/AppError');
const estoqueRepository = require('../repositories/estoqueRepository');
const eventosRepository = require('../repositories/eventosNegocioRepository');
const repository = require('../repositories/integracaoRecebimentoRepository');
const { TIPOS_EVENTO } = require('../constants/eventosNegocio');

async function aprovar(recebimentoId, usuario) {
    const empresaId = usuario.empresa_id;
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const recebimento = await repository.buscarPorIdForUpdate(
            recebimentoId,
            empresaId,
            client
        );

        if (!recebimento) {
            throw new AppError('Recebimento não encontrado', 404);
        }

        if (recebimento.status === 'APROVADO') {
            const evento = await eventosRepository.buscarPorEntidade(
                empresaId,
                'RECEBIMENTO',
                recebimentoId,
                TIPOS_EVENTO.RECEBIMENTO_APROVADO,
                client
            );
            await client.query('COMMIT');
            return { recebimento, idempotente: true, evento };
        }

        if (recebimento.status !== 'CONFERIDO') {
            throw new AppError('Somente recebimentos conferidos podem ser aprovados', 409);
        }

        const itens = await repository.listarItens(recebimentoId, empresaId, client);
        if (!itens.length) {
            throw new AppError('Recebimento sem itens não pode ser aprovado', 409);
        }

        const movimentacoes = [];

        for (const item of itens) {
            if (item.produto_id) {
                const movimento = await estoqueRepository.criarMovimentacao({
                    produto_id: item.produto_id,
                    tipo: 'entrada',
                    quantidade: Number(item.quantidade_recebida),
                    motivo: `Recebimento #${recebimento.id}`,
                    usuario_id: usuario.id,
                    empresa_id: empresaId
                }, client);

                if (movimento.erro === 'PRODUTO_NAO_ENCONTRADO') {
                    throw new AppError(`Produto ${item.produto_id} não encontrado`, 404);
                }
                if (movimento.erro === 'ESTOQUE_INSUFICIENTE') {
                    throw new AppError('Erro inesperado ao registrar entrada de estoque', 409);
                }

                movimentacoes.push(movimento.movimentacao);
            }

            const pedidoItem = await repository.atualizarQuantidadeRecebidaPedidoItem(
                item.pedido_compra_item_id,
                empresaId,
                client
            );

            if (!pedidoItem) {
                throw new AppError('Item do pedido de compra não encontrado', 404);
            }

            await repository.atualizarOrdensRelacionadas(
                item.pedido_compra_item_id,
                empresaId,
                client
            );
        }

        const pedidoId = recebimento.pedido_compra_id;
        const pedido = await repository.atualizarStatusPedido(pedidoId, empresaId, client);

        for (const item of itens) {
            await repository.atualizarStatusOrdensRelacionadas(
                item.pedido_compra_item_id,
                empresaId,
                client
            );
        }

        const atualizado = await repository.atualizarStatusComCliente(
            recebimentoId,
            empresaId,
            'APROVADO',
            client
        );

        const evento = await eventosRepository.criar({
            empresa_id: empresaId,
            filial_id: recebimento.filial_id,
            tipo_evento: TIPOS_EVENTO.RECEBIMENTO_APROVADO,
            entidade_tipo: 'RECEBIMENTO',
            entidade_id: recebimento.id,
            payload: {
                recebimento_id: recebimento.id,
                pedido_compra_id: recebimento.pedido_compra_id,
                fornecedor_id: recebimento.fornecedor_id,
                itens: itens.map(item => ({
                    recebimento_item_id: item.id,
                    pedido_compra_item_id: item.pedido_compra_item_id,
                    produto_id: item.produto_id,
                    quantidade: Number(item.quantidade_recebida),
                    unidade: item.unidade
                })),
                movimentacoes_estoque: movimentacoes.map(m => m.id),
                pedido_status: pedido?.status ?? null
            },
            usuario_id: usuario.id
        }, client);

        await eventosRepository.marcarProcessando(evento.id, empresaId, client);
        const processado = await eventosRepository.marcarProcessado(
            evento.id,
            empresaId,
            client
        );

        await client.query('COMMIT');

        return {
            recebimento: atualizado,
            pedido,
            evento: processado,
            movimentacoes_estoque: movimentacoes
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { aprovar };
