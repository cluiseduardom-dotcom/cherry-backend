'use strict';

// Catálogo de cargos do VERTUMNO. É o PADRÃO: cada comércio pode sobrescrever nível, se o
// cargo está ligado e as capacidades na tabela cargos_empresa (linha ausente = este padrão).
//
// perfil_base: o perfil "legado" com que o resto do sistema (requireAdmin, requireVendedor,
// requireEstoquista e os filtros de custo) já trabalha. Cargos novos entram com o acesso do
// Vendedor (SPEC, decisão 6) mais as capacidades explícitas; a matriz completa por tela fica
// para outra PR. Quem tem a capacidade `administrador` (pelo cargo ou por concessão) é
// tratado como perfil 'admin'.

const CAPACIDADES = Object.freeze({
    ADMINISTRADOR: 'administrador',
    VER_CUSTOS: 'ver_custos',
    VER_VENDAS_DE_TODOS: 'ver_vendas_de_todos',
    CANCELAR_VENDA: 'cancelar_venda',
    VER_CANCELAMENTOS: 'ver_cancelamentos',
    CONCEDER_ADMIN: 'conceder_admin',
    GERIR_CARGOS: 'gerir_cargos',
    GERIR_USUARIOS: 'gerir_usuarios'
});

const TODAS_CAPACIDADES = Object.freeze(Object.values(CAPACIDADES));

// Capacidades que o Admin do comércio pode atribuir a um cargo pela tela de cargos.
// `administrador` fica de fora: só se concede por fluxo próprio, com senha e auditoria.
const CAPACIDADES_CONFIGURAVEIS = Object.freeze(
    TODAS_CAPACIDADES.filter((capacidade) => capacidade !== CAPACIDADES.ADMINISTRADOR)
);

const NIVEL_ADMIN = 90;
const NIVEL_MINIMO = 1;
const NIVEL_MAXIMO = 89;

const PERFIL_ADMIN = 'admin';
const PERFIL_VENDEDOR = 'vendedor';
const PERFIL_ESTOQUISTA = 'estoquista';
const PERFIL_FATURISTA = 'faturista';

const { VER_CUSTOS, VER_VENDAS_DE_TODOS, CANCELAR_VENDA, VER_CANCELAMENTOS, GERIR_USUARIOS } = CAPACIDADES;

// `escada`: participa da hierarquia de autorização (tem nível). Estoquista e Faturista são
// funcionais e ficam fora. `sempre_ativo`: cargos básicos que o comércio não pode desligar.
const CATALOGO = Object.freeze({
    admin: {
        cargo: 'admin', rotulo: 'Admin', perfil_base: PERFIL_ADMIN, escada: true, nivel: NIVEL_ADMIN,
        sempre_ativo: true, imutavel: true, ativo_padrao: true, capacidades: []
    },
    diretor: {
        cargo: 'diretor', rotulo: 'Diretor', perfil_base: PERFIL_VENDEDOR, escada: true, nivel: 80,
        sempre_ativo: false, imutavel: false, ativo_padrao: false,
        capacidades: [VER_CUSTOS, VER_VENDAS_DE_TODOS, CANCELAR_VENDA, VER_CANCELAMENTOS, GERIR_USUARIOS]
    },
    gerente: {
        cargo: 'gerente', rotulo: 'Gerente', perfil_base: PERFIL_VENDEDOR, escada: true, nivel: 70,
        sempre_ativo: false, imutavel: false, ativo_padrao: false,
        capacidades: [VER_CUSTOS, VER_VENDAS_DE_TODOS, CANCELAR_VENDA, VER_CANCELAMENTOS, GERIR_USUARIOS]
    },
    coordenador: {
        cargo: 'coordenador', rotulo: 'Coordenador', perfil_base: PERFIL_VENDEDOR, escada: true, nivel: 60,
        sempre_ativo: false, imutavel: false, ativo_padrao: false,
        capacidades: [VER_CUSTOS, VER_VENDAS_DE_TODOS, CANCELAR_VENDA, VER_CANCELAMENTOS, GERIR_USUARIOS]
    },
    supervisor: {
        cargo: 'supervisor', rotulo: 'Supervisor', perfil_base: PERFIL_VENDEDOR, escada: true, nivel: 50,
        sempre_ativo: false, imutavel: false, ativo_padrao: false,
        capacidades: [VER_VENDAS_DE_TODOS, CANCELAR_VENDA, VER_CANCELAMENTOS, GERIR_USUARIOS]
    },
    analista: {
        cargo: 'analista', rotulo: 'Analista', perfil_base: PERFIL_VENDEDOR, escada: true, nivel: 40,
        sempre_ativo: false, imutavel: false, ativo_padrao: false,
        capacidades: [CANCELAR_VENDA]
    },
    vendedor: {
        cargo: 'vendedor', rotulo: 'Vendedor', perfil_base: PERFIL_VENDEDOR, escada: true, nivel: 30,
        sempre_ativo: true, imutavel: false, ativo_padrao: true,
        capacidades: [CANCELAR_VENDA]
    },
    operador: {
        cargo: 'operador', rotulo: 'Operador', perfil_base: PERFIL_VENDEDOR, escada: true, nivel: 20,
        sempre_ativo: false, imutavel: false, ativo_padrao: false,
        capacidades: [CANCELAR_VENDA]
    },
    auxiliar: {
        cargo: 'auxiliar', rotulo: 'Auxiliar', perfil_base: PERFIL_VENDEDOR, escada: true, nivel: 10,
        sempre_ativo: false, imutavel: false, ativo_padrao: false,
        capacidades: [CANCELAR_VENDA]
    },
    estoquista: {
        cargo: 'estoquista', rotulo: 'Estoquista', perfil_base: PERFIL_ESTOQUISTA, escada: false, nivel: null,
        sempre_ativo: true, imutavel: false, ativo_padrao: true, capacidades: []
    },
    faturista: {
        cargo: 'faturista', rotulo: 'Faturista', perfil_base: PERFIL_FATURISTA, escada: false, nivel: null,
        sempre_ativo: false, imutavel: false, ativo_padrao: false, capacidades: []
    }
});

const CARGOS = Object.freeze(Object.keys(CATALOGO));

module.exports = {
    CAPACIDADES,
    TODAS_CAPACIDADES,
    CAPACIDADES_CONFIGURAVEIS,
    CATALOGO,
    CARGOS,
    NIVEL_ADMIN,
    NIVEL_MINIMO,
    NIVEL_MAXIMO,
    PERFIL_ADMIN,
    PERFIL_VENDEDOR,
    PERFIL_ESTOQUISTA,
    PERFIL_FATURISTA
};
