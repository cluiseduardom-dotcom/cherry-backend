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

async function buscarPorId(id,usuario){return repository.buscarPorId(id,usuario.empresa_id);}
async function listar(filtros,usuario){return repository.listar(usuario.empresa_id,filtros);}
async function marcarConciliado(id,usuario){return repository.marcarConciliado(id,usuario.empresa_id);}

module.exports={criar,buscarPorId,listar,marcarConciliado};
