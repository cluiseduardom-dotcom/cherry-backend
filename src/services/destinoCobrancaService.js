const AppError = require('../errors/AppError');
const cobrancasRepository = require('../repositories/cobrancasPagamentoRepository');
const fiadoRepository = require('../repositories/fiadoRepository');
const contasReceberRepository = require('../repositories/contasReceberRepository');
const contasReceberService = require('./contasReceberService');
const { temCapacidade } = require('./permissoesService');
const { CAPACIDADES } = require('../constants/cargos');
const { reaisParaCentavos } = require('../utils/taxaPlataforma');

// Pix gerado para RECEBER fiado (Colheita) ou uma parcela/conta a receber. O dinheiro cai na conta Mercado Pago da empresa e,
// quando o Mercado Pago confirma, o servidor registra o recebimento sozinho — uma única vez (chave `pix-<codigo>` nos dois livros).

const TIPOS = { FIADO: 'fiado', CONTA_RECEBER: 'conta_receber' };

const chaveDaCobranca = (cobranca) => `pix-${cobranca.codigo}`;

// Mesmas regras de acesso das rotas que registram o recebimento "na mão": fiado = funcionalidade ligada + escopo de clientes;
// conta a receber = só administrador (como /contas-receber). empresa_id e usuário vêm do JWT.
async function validarDestino({ usuario, destino, valor }) {
    if (destino.tipo === TIPOS.FIADO) {
        if (!Array.isArray(usuario.funcionalidades) || !usuario.funcionalidades.includes('fiado')) {
            throw new AppError('Funcionalidade não incluída no seu plano. Fale com a GiroNex.', 403);
        }

        const escopo = temCapacidade(usuario, CAPACIDADES.VER_TODOS_CLIENTES) ? undefined : usuario.id;
        const { cliente, saldo } = await fiadoRepository.clienteComSaldo({ empresa_id: usuario.empresa_id, cliente_id: destino.cliente_id, escopo });

        if (!cliente.ativo || cliente.anonimizado) throw new AppError('Cliente inativo ou anonimizado não recebe lançamentos', 409);
        if (reaisParaCentavos(valor) > reaisParaCentavos(saldo)) throw new AppError('O valor do Pix é maior que o que o cliente deve na Colheita', 409);

        return { tipo: TIPOS.FIADO, id: destino.cliente_id };
    }

    if (usuario.role !== 'admin') throw new AppError('Acesso restrito a administradores', 403);

    const conta = await contasReceberRepository.buscarPorId(destino.conta_id, usuario.empresa_id);

    if (!conta) throw new AppError('Conta a receber não encontrada', 404);
    if (!conta.parcela_id) throw new AppError('Esta conta é de uma venda antiga e não recebe Pix pelo sistema', 409);
    if (conta.status !== 'pendente') throw new AppError('Somente contas pendentes podem receber pagamento', 409);
    if (reaisParaCentavos(valor) > reaisParaCentavos(conta.valor_restante)) throw new AppError('O valor do Pix é maior que o restante da conta', 409);

    return { tipo: TIPOS.CONTA_RECEBER, id: destino.conta_id };
}

async function aplicarNoDestino(cobranca) {
    const usuario = { id: cobranca.criado_por, empresa_id: cobranca.empresa_id };

    if (cobranca.destino_tipo === TIPOS.FIADO) {
        await fiadoRepository.lancar({
            empresa_id: cobranca.empresa_id,
            usuario_id: cobranca.criado_por,
            cliente_id: Number(cobranca.destino_id),
            tipo: 'pagamento',
            valor: cobranca.valor,
            forma: 'pix',
            chave: chaveDaCobranca(cobranca)
        });
        return;
    }

    await contasReceberService.receber(
        Number(cobranca.destino_id),
        { valor: Number(cobranca.valor), forma_pagamento: 'pix', observacao: 'Pix Mercado Pago', chave: chaveDaCobranca(cobranca) },
        usuario
    );
}

// Chamada quando a cobrança está paga (webhook, consulta ou nova consulta depois de uma falha de rede). Idempotente: aplicar de
// novo devolve o mesmo lançamento/recebimento (mesma chave) e a marcação só acontece uma vez. Erro de regra (saldo mudou, conta
// cancelada) é registrado em `destino_erro` e a cobrança segue em "Pix a devolver"; erro inesperado sobe e é refeito na próxima consulta.
async function aplicarSePago(cobranca) {
    if (cobranca?.status !== 'pago' || !cobranca.destino_tipo || cobranca.destino_aplicado_em || cobranca.destino_erro) return null;

    try {
        await aplicarNoDestino(cobranca);
    } catch (error) {
        if (error instanceof AppError) {
            await cobrancasRepository.registrarErroDestino(cobranca.id, cobranca.empresa_id, error.message);
            return null;
        }

        throw error;
    }

    return cobrancasRepository.marcarDestinoAplicado(cobranca.id, cobranca.empresa_id);
}

module.exports = { TIPOS, validarDestino, aplicarSePago };
