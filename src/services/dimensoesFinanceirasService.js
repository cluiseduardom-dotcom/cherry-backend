const AppError=require('../errors/AppError');
const repository=require('../repositories/dimensoesFinanceirasRepository');

function validarTexto(valor,mensagem){
    if(!valor || !String(valor).trim()) throw new AppError(mensagem,400);
}

async function criarCentroCusto(dados,usuario){
    validarTexto(dados.codigo,'Código do centro de custo é obrigatório');
    validarTexto(dados.nome,'Nome do centro de custo é obrigatório');
    return repository.criarCentroCusto({...dados,empresa_id:usuario.empresa_id});
}

async function listarCentrosCusto(filtros,usuario){
    return repository.listarCentrosCusto({...filtros,empresa_id:usuario.empresa_id});
}

async function criarProjeto(dados,usuario){
    validarTexto(dados.codigo,'Código do projeto é obrigatório');
    validarTexto(dados.nome,'Nome do projeto é obrigatório');
    return repository.criarProjeto({...dados,empresa_id:usuario.empresa_id});
}

async function listarProjetos(filtros,usuario){
    return repository.listarProjetos({...filtros,empresa_id:usuario.empresa_id});
}

module.exports={criarCentroCusto,listarCentrosCusto,criarProjeto,listarProjetos};
