const crypto = require('node:crypto');

// Validação do cabeçalho x-signature dos webhooks do Mercado Pago.
//
// ATENÇÃO — a documentação pública consultada NÃO descreve o manifesto assinado. O formato abaixo
// (id:<data.id>;request-id:<x-request-id>;ts:<ts>; com HMAC-SHA256 em hexadecimal) segue o que o
// conhecimento geral sobre a API indica e DEVE ser confirmado no sandbox antes de produção.
// Isolado neste arquivo para que um ajuste não se espalhe pelo sistema.

function lerAssinatura(xSignature) {
    const campos = {};

    for (const parte of String(xSignature || '').split(',')) {
        const indice = parte.indexOf('=');

        if (indice > 0) {
            campos[parte.slice(0, indice).trim()] = parte.slice(indice + 1).trim();
        }
    }

    return { ts: campos.ts, v1: campos.v1 };
}

function montarManifesto({ dataId, requestId, ts }) {
    const partes = [];

    if (dataId) {
        // ids alfanuméricos entram em minúsculas; ids numéricos não mudam.
        partes.push(`id:${String(dataId).toLowerCase()};`);
    }

    if (requestId) {
        partes.push(`request-id:${requestId};`);
    }

    partes.push(`ts:${ts};`);

    return partes.join('');
}

function calcularAssinatura({ dataId, requestId, ts, segredo }) {
    return crypto.createHmac('sha256', segredo).update(montarManifesto({ dataId, requestId, ts })).digest('hex');
}

function assinaturaValida({ xSignature, xRequestId, dataId, segredo }) {
    if (!segredo) {
        return false;
    }

    const { ts, v1 } = lerAssinatura(xSignature);

    if (!ts || !v1 || !/^[0-9a-f]+$/i.test(v1)) {
        return false;
    }

    const esperado = Buffer.from(calcularAssinatura({ dataId, requestId: xRequestId, ts, segredo }), 'hex');
    const recebido = Buffer.from(v1, 'hex');

    return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

module.exports = { assinaturaValida, calcularAssinatura, montarManifesto, lerAssinatura };
