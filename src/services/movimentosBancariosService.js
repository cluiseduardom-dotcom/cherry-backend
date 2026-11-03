const AppError=require('../errors/AppError');
const repository=require('../repositories/movimentosBancariosRepository');
const contasRepo=require('../repositories/contasBancariasRepository');
const liquidacoesRepo=require('../repositories/liquidacoesPagamentoRepository');

const TIPOS=new Set(['ENTRADA','SAIDA']);
const ORIGENS=new Set(['MANUAL','PAGAMENTO','RECEBIMENTO','TRANSFERENCIA','OPEN_FINANCE','API_BANCO','AJUSTE']);

async function criar(dados,usuario){
    if(!Number.isInteger(Number(dados.conta_bancaria_id)) || Number(dados.conta_bancaria_id)<=0)
        throw new AppError('Conta bancária inválida',400);
    if(!TIPOS.has(dados.tipo)) throw new AppError('Tipo de movimento inválido',400);
    const origem=dados.origem??'MANUAL';
    if(!ORIGENS.has(origem)) throw new AppError('Origem do movimento inválida',400);
    const valor=Number(dados.valor);
    if(!Number.isFinite(valor)||valor<=0) throw new AppError('Valor do movimento inválido',400);

    const conta=await contasRepo.buscarPorId(Number(dados.conta_bancaria_id),usuario.empresa_id);
    if(!conta) throw new AppError('Conta bancária não encontrada',404);
    if(conta.status!=='ATIVA') throw new AppError('Conta bancária não está ativa',400);

    if(dados.liquidacao_pagamento_id!=null){
        const liq=await liquidacoesRepo.buscarPorId(Number(dados.liquidacao_pagamento_id),usuario.empresa_id);
        if(!liq) throw new AppError('Liquidação não encontrada',404);
        if(liq.status!=='LIQUIDADA') throw new AppError('Liquidação ainda não está liquidada',400);
    }

    return repository.criar({
        ...dados,
        empresa_id:usuario.empresa_id,
        valor,
        usuario_id:usuario.id??dados.usuario_id??null
    });
}

const hojeBrasilia=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});

// Lançamento feito por uma pessoa: origem sempre MANUAL, data só do dia (meio-dia de Brasília, para não
// virar o dia por fuso) e nunca no futuro — o que ainda vai acontecer é conta a pagar/receber, não saldo.
async function lancarManual(dados,usuario){
    if(dados.data_movimento>hojeBrasilia()) throw new AppError('Movimento manual não pode ter data futura',400);
    return criar({
        conta_bancaria_id:dados.conta_bancaria_id,
        tipo:dados.tipo,
        origem:'MANUAL',
        valor:dados.valor,
        data_movimento:`${dados.data_movimento}T12:00:00-03:00`,
        descricao:dados.descricao,
        observacao:dados.observacao??null
    },usuario);
}

async function buscarPorId(id,usuario){return repository.buscarPorId(id,usuario.empresa_id);}
async function listar(filtros,usuario){return repository.listar(usuario.empresa_id,filtros);}
async function marcarConciliado(id,usuario){return repository.marcarConciliado(id,usuario.empresa_id);}

// Movimento não se apaga: cancela-se, com motivo, e o saldo deixa de contá-lo. Conciliado exige desfazer antes.
async function cancelar(id,motivo,usuario){
    const movimento=await repository.buscarPorId(id,usuario.empresa_id);
    if(!movimento) throw new AppError('Movimento bancário não encontrado',404);
    if(movimento.cancelado_em) throw new AppError('Movimento já cancelado',409);
    if(movimento.conciliado) throw new AppError('Movimento conciliado: desfaça a conciliação antes de cancelar',409);
    const cancelado=await repository.cancelar(id,usuario.empresa_id,usuario.id,motivo);
    if(!cancelado) throw new AppError('Movimento não pôde ser cancelado (já conciliado ou cancelado)',409);
    return cancelado;
}

module.exports={criar,lancarManual,buscarPorId,listar,marcarConciliado,cancelar};
