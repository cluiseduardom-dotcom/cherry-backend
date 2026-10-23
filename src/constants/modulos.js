// Catálogo fechado de módulos habilitáveis por empresa (ADR-007). O "core" não é módulo:
// está sempre ativo. Adicionar um módulo exige migration corretiva do CHECK da tabela
// empresa_modulos e uma entrada aqui; o teste de migration garante que os dois coincidem.
const MODULOS = ['grade', 'fracionario', 'rastreio_unidade', 'fiscal', 'multi_pdv', 'servicos_agenda'];

module.exports = { MODULOS };
