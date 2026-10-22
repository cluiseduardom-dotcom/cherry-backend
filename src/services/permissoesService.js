'use strict';

const {
    CATALOGO,
    CAPACIDADES,
    TODAS_CAPACIDADES,
    PERFIL_ADMIN
} = require('../constants/cargos');

// Funções PURAS (sem banco): resolvem o que um cargo pode, no comércio dele, a partir do
// padrão do catálogo e da linha opcional de cargos_empresa. Quem lê o banco é o
// sessaoRepository (uma única consulta por requisição).

// `linha` = { nivel, ativo, capacidades } de cargos_empresa, ou null/undefined quando o
// comércio nunca editou o cargo (vale o padrão do catálogo).
function resolverCargo(cargo, linha) {
    const definicao = CATALOGO[cargo];

    if (!definicao) return null;

    const configurado = Boolean(linha) && !definicao.imutavel;

    const ativo = definicao.sempre_ativo
        ? true
        : (configurado ? Boolean(linha.ativo) : definicao.ativo_padrao);

    const nivel = definicao.imutavel
        ? definicao.nivel
        : (configurado && definicao.escada ? linha.nivel : definicao.nivel);

    const capacidades = definicao.imutavel
        ? [...TODAS_CAPACIDADES]
        : (configurado ? [...linha.capacidades] : [...definicao.capacidades]);

    const administrador = capacidades.includes(CAPACIDADES.ADMINISTRADOR);

    return {
        cargo,
        rotulo: definicao.rotulo,
        // Perfil com que as rotas e os filtros já existentes enxergam o usuário.
        role: administrador ? PERFIL_ADMIN : definicao.perfil_base,
        nivel,
        ativo,
        capacidades,
        administrador,
        escada: definicao.escada
    };
}

// Concessões individuais (usuario_privilegios) somam-se ao cargo: hoje só `administrador`, que dá
// perfil admin e TODAS as capacidades. Função pura; `permissoes` vem de resolverCargo.
function aplicarConcessoes(permissoes, { administrador_concedido = false } = {}) {
    if (!permissoes || !administrador_concedido) return permissoes;

    return {
        ...permissoes,
        role: PERFIL_ADMIN,
        administrador: true,
        capacidades: [...TODAS_CAPACIDADES]
    };
}

// Capacidade vale para quem a tem no cargo; Admin (por cargo ou por concessão) tem todas.
function temCapacidade(usuario, capacidade) {
    if (!usuario) return false;
    if (usuario.role === PERFIL_ADMIN) return true;

    return Array.isArray(usuario.capacidades) && usuario.capacidades.includes(capacidade);
}

const podeVerCustos = (usuario) => temCapacidade(usuario, CAPACIDADES.VER_CUSTOS);

// Telas operacionais de produto/venda/preço: o Estoquista sempre viu custo (compra e produção),
// o Admin também; o Vendedor e qualquer cargo sem a capacidade `ver_custos` não. Perfil
// desconhecido (ex.: Faturista) não vê: o padrão é ocultar.
const podeVerCustosOperacionais = (usuario) =>
    Boolean(usuario) && (usuario.role === PERFIL_ADMIN || usuario.role === 'estoquista' || podeVerCustos(usuario));
const podeVerVendasDeTodos = (usuario) => temCapacidade(usuario, CAPACIDADES.VER_VENDAS_DE_TODOS);

module.exports = {
    resolverCargo,
    aplicarConcessoes,
    temCapacidade,
    podeVerCustos,
    podeVerCustosOperacionais,
    podeVerVendasDeTodos
};
