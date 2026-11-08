// Catálogo de funcionalidades que a GiroNex liga e desliga por plano e por empresa (ADR-007, revisado).
// Duas espécies:
//   recurso  funcionalidade que o ERP já tem e que passa a ser vendida por plano ou avulsa;
//   modulo   módulo novo; só liga quando `vendavel` for verdadeiro (módulo ainda não construído = "em breve").
// O núcleo do ERP (PDV, produtos, clientes, estoque central, compras, contas a pagar/receber, Pix e cartão)
// NÃO é funcionalidade: está sempre ativo.
// O catálogo continua fechado: só migration insere em `funcionalidades`, nenhuma rota de tenant escreve nela.
// O teste de migration garante que este arquivo e o seed da migration 089 coincidem.
const FUNCIONALIDADES = [
    { codigo: 'comissoes', tipo: 'recurso', nome: 'Comissões', vendavel: true },
    { codigo: 'maletas', tipo: 'recurso', nome: 'Maletas e múltiplos locais', vendavel: true },
    { codigo: 'bancos', tipo: 'recurso', nome: 'Bancos e conciliação', vendavel: true },
    { codigo: 'analise_financeira', tipo: 'recurso', nome: 'Análise financeira: ponto de equilíbrio e despesas fixas', vendavel: true },
    { codigo: 'fiscal', tipo: 'modulo', nome: 'Fiscal', vendavel: false },
    { codigo: 'pcp', tipo: 'modulo', nome: 'PCP: ordem de produção, ordem de serviço e consumo', vendavel: false },
    { codigo: 'grade', tipo: 'modulo', nome: 'Grade de produtos', vendavel: false },
    { codigo: 'fracionario', tipo: 'modulo', nome: 'Venda fracionada', vendavel: false },
    { codigo: 'rastreio_unidade', tipo: 'modulo', nome: 'Rastreio por unidade', vendavel: false },
    { codigo: 'multi_pdv', tipo: 'modulo', nome: 'Vários PDVs', vendavel: false },
    { codigo: 'servicos_agenda', tipo: 'modulo', nome: 'Serviços e agenda', vendavel: false },
    // Entrou na migration 095 (canal e-commerce). Nenhum plano a inclui; a GiroNex liga avulsa, por empresa.
    { codigo: 'loja_online', tipo: 'modulo', nome: 'Loja online (e-commerce)', vendavel: true }
];

const CODIGOS_FUNCIONALIDADES = FUNCIONALIDADES.map((f) => f.codigo);

// Recursos que o plano Padrão e o Pro incluem, e que os planos legados (sem_mensalidade, com_mensalidade)
// também incluem para que nenhuma empresa existente perca acesso pela migration.
const RECURSOS = FUNCIONALIDADES.filter((f) => f.tipo === 'recurso').map((f) => f.codigo);

module.exports = { FUNCIONALIDADES, CODIGOS_FUNCIONALIDADES, RECURSOS };
