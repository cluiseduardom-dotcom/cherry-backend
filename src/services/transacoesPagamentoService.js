const AppError=require('../errors/AppError');
const repository=require('../repositories/transacoesPagamentoRepository');

const FORMAS=new Set(['PIX','DINHEIRO','DEBITO','CREDITO','BOLETO','TRANSFERENCIA','OUTRO']);
const TIPOS=new Set(['PAGAMENTO','RECEBIMENTO','ESTORNO']);
const ORIGENS=new Set(['MANUAL','GATEWAY','TEF','OPEN_FINANCE','API_BANCO']);

async function criar(dados,usuario){
    if(!TIPOS.has(dados.tipo)) throw new AppError('Tipo de transação de pagamento inválido',400);
    if(!FORMAS.has(dados.forma_pagamento)) throw new AppError('Forma de pagamento inválida',400);
    if(!ORIGENS.has(dados.origem ?? 'MANUAL')) throw new AppError('Origem da transação inválida',400);
    if(!(Number(dados.valor)>0)) throw new AppError('Valor da transação deve ser maior que zero',400);

    const taxa=Number(dados.taxa||0);
    if(taxa<0 || taxa>Number(dados.valor)) throw new AppError('Taxa de pagamento inválida',400);

    return repository.criar({
        ...dados,
        empresa_id:usuario.empresa_id,
        taxa,
        valor_liquido:Number(dados.valor)-taxa,
        usuario_id:usuario.id
    });
}

async function criarParcela(transacaoId,dados,usuario){
    const transacao=await repository.buscarPorId(transacaoId,usuario.empresa_id);
    if(!transacao) throw new AppError('Transação de pagamento não encontrada',404);
    if(!(Number(dados.numero)>0)) throw new AppError('Número da parcela inválido',400);
    if(!(Number(dados.valor)>0)) throw new AppError('Valor da parcela deve ser maior que zero',400);

    return repository.criarParcela({
        ...dados,
        empresa_id:usuario.empresa_id,
        transacao_pagamento_id:transacaoId
    });
}

async function obter(id,usuario){
    const transacao=await repository.buscarPorId(id,usuario.empresa_id);
    if(!transacao) throw new AppError('Transação de pagamento não encontrada',404);
    return {...transacao,parcelas:await repository.listarParcelas(id,usuario.empresa_id)};
}

module.exports={criar,criarParcela,obter};
