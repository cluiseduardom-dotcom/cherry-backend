// Conjunto fechado de identidades visuais. Deve acompanhar o CHECK da migration 049
// e os temas do cherry-frontend (src/theme/themes.js).
const TEMAS_VISUAIS = Object.freeze(['vertumno', 'cherry']);
const TEMA_VISUAL_PADRAO = 'vertumno';

// Ausente, desconhecido ou inválido cai no padrão: o login nunca quebra por causa do tema.
function resolverTemaVisual(valor) {
    return TEMAS_VISUAIS.includes(valor) ? valor : TEMA_VISUAL_PADRAO;
}

module.exports = { TEMAS_VISUAIS, TEMA_VISUAL_PADRAO, resolverTemaVisual };
