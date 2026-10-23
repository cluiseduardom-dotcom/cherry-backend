// Conjunto fechado de origens de aquisição de um tenant (SPEC 03, fase 4: fornecedor
// como canal). Deve acompanhar o CHECK da migration 054. O valor é interno da
// GiroOne: não é exposto pela API de tenant.
const ORIGENS_AQUISICAO = Object.freeze(['direta', 'indicacao_parceiro', 'outro']);
const ORIGEM_AQUISICAO_PADRAO = 'direta';

// Código do parceiro: texto curto, sem espaços, normalizado em maiúsculas para que
// a métrica por parceiro não se fragmente por diferença de caixa.
const PARCEIRO_CODIGO_REGEX = /^[A-Z0-9_-]{2,40}$/;

module.exports = { ORIGENS_AQUISICAO, ORIGEM_AQUISICAO_PADRAO, PARCEIRO_CODIGO_REGEX };
