// Regras puras do comprovante de pagamento da taxa: tipos aceitos (pelo conteúdo real, nunca pelo
// content-type ou extensão do cliente), tamanho e formato da chave no bucket privado.

const MAX_BYTES = 5 * 1024 * 1024;

const TIPOS = Object.freeze({
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png'
});

function detectarTipo(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    return null;
}

// Chave sempre gerada pelo backend, presa à empresa e ao período: taxas/<empresa>/<periodo>/<uuid>.<ext>.
function montarChave({ empresa_id, periodo_id, uuid, extensao }) {
    return `taxas/${empresa_id}/${periodo_id}/${uuid}.${extensao}`;
}

const CHAVE_RE = /^taxas\/(\d+)\/(\d+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/;

// A chave pertence a este período desta empresa? (o pagamento não aceita comprovante de outro período/empresa)
function chaveDoPeriodo(chave, { empresa_id, periodo_id }) {
    const m = CHAVE_RE.exec(String(chave ?? ''));
    return Boolean(m) && Number(m[1]) === Number(empresa_id) && Number(m[2]) === Number(periodo_id);
}

function tipoDaChave(chave) {
    const extensao = String(chave).split('.').pop();
    return Object.keys(TIPOS).find((tipo) => TIPOS[tipo] === extensao) ?? 'application/octet-stream';
}

module.exports = { MAX_BYTES, TIPOS, CHAVE_RE, detectarTipo, montarChave, chaveDoPeriodo, tipoDaChave };
