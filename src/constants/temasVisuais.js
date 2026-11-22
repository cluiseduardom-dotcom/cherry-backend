// Conjunto fechado de identidades visuais. Deve acompanhar o CHECK das migrations 081 e 130
// e os temas do cherry-frontend (src/theme/themes.js).
// `emilly` é tema de DEMONSTRAÇÃO (confeitaria de teste, migration 130): fácil de remover se não seguir.
const TEMAS_VISUAIS = Object.freeze(['vertumno', 'cherry', 'valvazori', 'emilly']);
const TEMA_VISUAL_PADRAO = 'vertumno';

// Ausente, desconhecido ou inválido cai no padrão: o login nunca quebra por causa do tema.
function resolverTemaVisual(valor) {
    return TEMAS_VISUAIS.includes(valor) ? valor : TEMA_VISUAL_PADRAO;
}

// Identificador público da empresa na URL de login (/c/<slug>). Deve acompanhar o CHECK da 081.
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

// Nomes que ficam fora do uso por empresa: reservados para endereços da própria plataforma.
const SLUGS_RESERVADOS = Object.freeze(['app', 'www', 'api', 'admin', 'plataforma', 'login', 'staging', 'vertumno', 'gironex']);

module.exports = { TEMAS_VISUAIS, TEMA_VISUAL_PADRAO, resolverTemaVisual, SLUG_REGEX, SLUGS_RESERVADOS };
