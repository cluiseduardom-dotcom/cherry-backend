const db = require('../config/db');
const AppError = require('../errors/AppError');
const { numeroFinito } = require('../utils/numeros');
const pagamentosRepository = require('../repositories/pagamentosVendaRepository');
const parcelasRepository = require('../repositories/parcelasPagamentoRepository');
const recebimentosRepository = require('../repositories/recebimentosContaRepository');
const estornosRepository = require('../repositories/estornosPagamentoRepository');
const caixaRepository = require('../repositories/caixaRepository');
const contasReceberRepository = require('../repositories/contasReceberRepository');
const comissoesRepository = require('../repositories/comissoesRepository');
const { hojeSP } = require('../utils/dataSaoPaulo');

// Data de hoje em São Paulo (o servidor roda em UTC).
const hoje = () => hojeSP();

// Recebe (total ou parcialmente) uma parcela. `receberRestante` = o servidor calcula o restante DENTRO da trava (a tela nunca
// decide o valor de "receber tudo"). `chave` = Idempotency-Key: repetir a mesma chave devolve o recebimento original.
async function receberParcela(id, { valor, forma_pagamento = 'dinheiro', observacao = null, chave = null, receberRestante = false }, usuario) {
    const valorInformado = receberRestante ? 0 : numeroFinito(valor, 'Valor do recebimento inválido');
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT pp.*, pv.forma_pagamento, pv.venda_id
             FROM parcelas_pagamento pp
             JOIN pagamentos_venda pv ON pv.id = pp.pagamento_id
             WHERE pp.id = $1 AND pp.empresa_id = $2
             FOR UPDATE`,
            [id, usuario.empresa_id]
        );

        if (!rows.length) throw new AppError('Parcela não encontrada', 404);
        const parcela = rows[0];

        if (['cancelada', 'estornada'].includes(parcela.status)) {
            throw new AppError('Parcela não pode receber pagamento neste estado', 409);
        }

        // Repetição (retry, duplo clique): a parcela já está travada, então a conferência da chave é segura.
        if (chave) {
            const anterior = await recebimentosRepository.buscarPorChave(usuario.empresa_id, chave, client);

            if (anterior) {
                const mesmo = Number(anterior.parcela_id) === id && anterior.forma_pagamento === forma_pagamento
                    && (receberRestante || Number(anterior.valor) === Number(valorInformado.toFixed(2)));

                if (!mesmo) throw new AppError('Idempotency-Key já usada com outro conteúdo', 409);

                await client.query('COMMIT');
                return { recebimento: anterior, parcela: await parcelasRepository.buscarPorId(id, usuario.empresa_id), reaproveitado: true };
            }
        }

        const recebidoAnterior = await recebimentosRepository.somarPorParcela(id, usuario.empresa_id, client);
        const restante = Number((Number(parcela.valor) - recebidoAnterior).toFixed(2));
        const valorReceber = receberRestante ? restante : Number(valorInformado.toFixed(2));

        if (valorReceber <= 0) {
            throw new AppError(receberRestante ? 'Esta parcela não tem saldo a receber' : 'Valor do recebimento deve ser maior que zero', receberRestante ? 409 : 400);
        }

        if (valorReceber > restante) {
            throw new AppError('Valor do recebimento excede o saldo da parcela', 409);
        }

        const recebimento = await recebimentosRepository.criar({
            parcela_id: id,
            empresa_id: usuario.empresa_id,
            valor: valorReceber,
            forma_pagamento,
            usuario_id: usuario.id,
            data_recebimento: hoje(),
            observacao,
            chave_idempotencia: chave,
            // Entra no caixa aberto de quem recebe (PR D); sem caixa aberto, fica fora de caixa e não bloqueia o recebimento.
            caixa_sessao_id: await caixaRepository.sessaoAbertaDoOperador(client, usuario.empresa_id, usuario.id, { travar: true })
        }, client);

        const novoTotalPago = Number((recebidoAnterior + valorReceber).toFixed(2));
        const novoStatus = novoTotalPago === Number(parcela.valor) ? 'recebida' : 'parcial';

        const parcelaAtualizada = await parcelasRepository.atualizarRecebimento(id, {
            valor_pago: novoTotalPago,
            status: novoStatus,
            data_pagamento: novoStatus === 'recebida' ? hoje() : null,
            usuario_baixa_id: usuario.id
        }, usuario.empresa_id, client);

        const conta = await contasReceberRepository.buscarPorParcelaId(id, usuario.empresa_id, client);
        if (conta) {
            await contasReceberRepository.atualizarRecebimento(conta.id, {
                status: novoStatus === 'recebida' ? 'recebido' : 'pendente',
                data_recebimento: novoStatus === 'recebida' ? hoje() : null
            }, usuario.empresa_id, client);
        }

        const { rows: resumoParcelas } = await client.query(
            `SELECT
                COUNT(*) FILTER (WHERE status NOT IN ('recebida','cancelada','estornada')) AS abertas,
                COUNT(*) FILTER (WHERE status = 'recebida') AS recebidas
             FROM parcelas_pagamento WHERE pagamento_id = $1 AND empresa_id = $2`,
            [parcela.pagamento_id, usuario.empresa_id]
        );

        if (Number(resumoParcelas[0].abertas) === 0) {
            await pagamentosRepository.atualizarStatus(parcela.pagamento_id, 'pago', usuario.empresa_id, client);
        } else if (novoStatus === 'parcial' || Number(resumoParcelas[0].recebidas) > 0) {
            await pagamentosRepository.atualizarStatus(parcela.pagamento_id, 'parcial', usuario.empresa_id, client);
        }

        // A comissão da venda libera na proporção do que já foi pago (mesma transação).
        await comissoesRepository.recalcularLiberacao({
            venda_id: parcela.venda_id, empresa_id: usuario.empresa_id, origem: 'pagamento', executado_por: usuario.id
        }, client);

        await client.query('COMMIT');
        return { recebimento, parcela: parcelaAtualizada, reaproveitado: false };
    } catch (error) {
        await client.query('ROLLBACK');
        // Mesma chave usada em outra parcela ao mesmo tempo: a unicidade do banco barra.
        if (error && error.code === '23505' && /uq_recebimentos_conta_chave/.test(error.constraint ?? error.message ?? '')) {
            throw new AppError('Idempotency-Key já usada com outro conteúdo', 409);
        }
        throw error;
    } finally {
        client.release();
    }
}

async function estornarPagamento(id, { valor, motivo }, usuario) {
    const valorInformado = numeroFinito(valor, 'Valor do estorno inválido');
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const pagamento = await pagamentosRepository.buscarPorId(id, usuario.empresa_id, client);
        if (!pagamento) throw new AppError('Pagamento não encontrado', 404);
        if (pagamento.status === 'cancelado') throw new AppError('Pagamento cancelado não pode ser estornado', 409);

        const totalEstornado = await pagamentosRepository.somarEstornos(id, usuario.empresa_id, client);
        const valorEstorno = Number(valorInformado.toFixed(2));
        const saldoEstornavel = Number((Number(pagamento.valor) - totalEstornado).toFixed(2));

        if (valorEstorno <= 0) throw new AppError('Valor do estorno deve ser maior que zero', 400);
        if (valorEstorno > saldoEstornavel) throw new AppError('Estorno excede o saldo disponível do pagamento', 409);
        if (!motivo || !motivo.trim()) throw new AppError('Informe o motivo do estorno', 400);

        const estorno = await estornosRepository.criar({
            pagamento_id: id,
            empresa_id: usuario.empresa_id,
            valor: valorEstorno,
            motivo: motivo.trim(),
            usuario_id: usuario.id,
            // O valor sai da sessão de caixa do pagamento (se aberta) ou da de quem estorna (PR C).
            caixa_sessao_id: await caixaRepository.sessaoParaEstorno(client, {
                empresa_id: usuario.empresa_id, usuario_id: usuario.id, sessao_original_id: pagamento.caixa_sessao_id
            })
        }, client);

        const totalAposEstorno = Number((totalEstornado + valorEstorno).toFixed(2));
        if (totalAposEstorno === Number(pagamento.valor)) {
            await pagamentosRepository.atualizarStatus(id, 'estornado', usuario.empresa_id, client);
            await client.query(
                `UPDATE parcelas_pagamento SET status = 'estornada', atualizado_em = NOW()
                 WHERE pagamento_id = $1 AND empresa_id = $2 AND status NOT IN ('recebida','cancelada','estornada')`,
                [id, usuario.empresa_id]
            );
        }

        // Estorno de pagamento reduz a parte liberada da comissão (mesma transação).
        await comissoesRepository.recalcularLiberacao({
            venda_id: pagamento.venda_id, empresa_id: usuario.empresa_id, origem: 'estorno_pagamento', executado_por: usuario.id
        }, client);

        await client.query('COMMIT');
        return estorno;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function buscarPagamento(id, usuario) {
    const pagamento = await pagamentosRepository.buscarPorId(id, usuario.empresa_id);
    if (!pagamento) throw new AppError('Pagamento não encontrado', 404);

    const [parcelas, estornos] = await Promise.all([
        parcelasRepository.listarPorPagamento(id, usuario.empresa_id),
        estornosRepository.listarPorPagamento(id, usuario.empresa_id)
    ]);

    return { ...pagamento, parcelas, estornos };
}

module.exports = { receberParcela, estornarPagamento, buscarPagamento };
