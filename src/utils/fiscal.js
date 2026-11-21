'use strict';

// Preparo fiscal: validação ESTRUTURAL dos dados cadastrais que uma nota fiscal vai pedir. Não valida regra
// tributária (isso é do contador) nem consulta tabela oficial: um NCM com formato certo pode não existir.
// Sem emissão de nota nesta etapa.

const REGIMES_TRIBUTARIOS = ['mei', 'simples_nacional', 'simples_nacional_excesso', 'lucro_presumido', 'lucro_real'];
const AMBIENTES_FISCAIS = ['homologacao', 'producao'];

// Código IBGE da UF = dois primeiros dígitos do código do município.
const CODIGO_IBGE_DA_UF = {
    RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
    MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
    MG: '31', ES: '32', RJ: '33', SP: '35',
    PR: '41', SC: '42', RS: '43',
    MS: '50', MT: '51', GO: '52', DF: '53'
};

const soDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');

// NCM: 8 dígitos; capítulo (2 primeiros) de 01 a 97, exceto 77 (reservado no Sistema Harmonizado).
function ncmValido(ncm) {
    if (typeof ncm !== 'string' || !/^\d{8}$/.test(ncm)) return false;

    const capitulo = Number(ncm.slice(0, 2));

    return capitulo >= 1 && capitulo <= 97 && capitulo !== 77;
}

const cestValido = (cest) => typeof cest === 'string' && /^\d{7}$/.test(cest);

// Origem da mercadoria: 0 a 8 (0 nacional, 1 e 2 estrangeira, 3 a 5 nacional com conteúdo de importação, 6 e 7 sem
// similar nacional, 8 nacional com conteúdo de importação superior a 70%).
const origemValida = (origem) => Number.isInteger(origem) && origem >= 0 && origem <= 8;

// Unidade comercial/tributável: sigla de 1 a 6 letras maiúsculas (UN, KG, LT, CX...).
const unidadeFiscalValida = (unidade) => typeof unidade === 'string' && /^[A-Z]{1,6}$/.test(unidade);

// Inscrição estadual: só dígitos (cada UF tem seu tamanho; aqui 2 a 14) ou ISENTO.
const inscricaoEstadualValida = (ie) => typeof ie === 'string' && (ie === 'ISENTO' || /^\d{2,14}$/.test(ie));

const cnaeValido = (cnae) => typeof cnae === 'string' && /^\d{7}$/.test(cnae);

const codigoMunicipioValido = (codigo) => typeof codigo === 'string' && /^\d{7}$/.test(codigo);

// O código do município começa com o código da UF: pega o erro de digitar município de outro estado.
function municipioCombinaComUf(codigoMunicipio, uf) {
    const prefixo = CODIGO_IBGE_DA_UF[String(uf ?? '').toUpperCase()];

    return Boolean(prefixo) && codigoMunicipioValido(codigoMunicipio) && codigoMunicipio.startsWith(prefixo);
}

module.exports = {
    REGIMES_TRIBUTARIOS,
    AMBIENTES_FISCAIS,
    CODIGO_IBGE_DA_UF,
    soDigitos,
    ncmValido,
    cestValido,
    origemValida,
    unidadeFiscalValida,
    inscricaoEstadualValida,
    cnaeValido,
    codigoMunicipioValido,
    municipioCombinaComUf
};
