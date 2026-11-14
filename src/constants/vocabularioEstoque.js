'use strict';

// Vocabulário do estoque que fica com o vendedor. O tipo técnico do local é sempre `maleta`; aqui só mudam as PALAVRAS que o
// usuário vê, por empresa (empresas.rotulo_estoque_vendedor). A lista é fechada e cada opção traz as frases já concordadas
// (gênero e preposição), para nenhuma mensagem sair com "o maleta" ou "da estoque".
//   maleta            semijoias e acessórios (a maleta que a revendedora leva);
//   estoque_vendedor  padrão neutro para os demais ramos.
const VOCABULARIOS = Object.freeze({
    maleta: Object.freeze({
        chave: 'maleta',
        nome: 'Maleta',
        nomeMinusculo: 'maleta',
        plural: 'Maletas',
        pluralMinusculo: 'maletas',
        minha: 'Minha maleta',
        da: 'da maleta',
        na: 'na maleta',
        daSuaPropria: 'da sua própria maleta',
        daPessoa: (nome) => `Maleta de ${nome}`,
        descricao: 'Para semijoias e acessórios'
    }),
    estoque_vendedor: Object.freeze({
        chave: 'estoque_vendedor',
        nome: 'Estoque do vendedor',
        nomeMinusculo: 'estoque do vendedor',
        plural: 'Estoques dos vendedores',
        pluralMinusculo: 'estoques dos vendedores',
        minha: 'Meu estoque',
        da: 'do estoque do vendedor',
        na: 'no estoque do vendedor',
        daSuaPropria: 'do seu próprio estoque',
        daPessoa: (nome) => `Estoque de ${nome}`,
        descricao: 'Para os demais ramos'
    })
});

const CHAVES_VOCABULARIO = Object.freeze(Object.keys(VOCABULARIOS));
const PADRAO_EMPRESA_EXISTENTE = 'maleta';
const PADRAO_EMPRESA_NOVA = 'estoque_vendedor';

/** Vocabulário da chave; chave desconhecida ou ausente cai em "maleta" (comportamento anterior, nunca quebra). */
function vocabularioEstoque(chave) {
    return VOCABULARIOS[chave] ?? VOCABULARIOS[PADRAO_EMPRESA_EXISTENTE];
}

module.exports = { VOCABULARIOS, CHAVES_VOCABULARIO, PADRAO_EMPRESA_EXISTENTE, PADRAO_EMPRESA_NOVA, vocabularioEstoque };
