const { assinaturaValida, calcularAssinatura, montarManifesto, lerAssinatura } = require('../../src/utils/mercadoPagoAssinatura');

const segredo = 'segredo-de-teste';
const base = { dataId: '123456', requestId: 'req-abc', ts: '1700000000' };
const cabecalho = (v1, ts = base.ts) => `ts=${ts},v1=${v1}`;

describe('mercadoPagoAssinatura', () => {
    test('monta o manifesto com id, request-id e ts (id alfanumérico em minúsculas)', () => {
        expect(montarManifesto(base)).toBe('id:123456;request-id:req-abc;ts:1700000000;');
        expect(montarManifesto({ ...base, dataId: 'ABC123' })).toBe('id:abc123;request-id:req-abc;ts:1700000000;');
        expect(montarManifesto({ ts: '1' })).toBe('ts:1;');
    });

    test('lê ts e v1 do cabeçalho', () => {
        expect(lerAssinatura('ts=1,v1=ab')).toEqual({ ts: '1', v1: 'ab' });
        expect(lerAssinatura('')).toEqual({ ts: undefined, v1: undefined });
    });

    test('aceita assinatura correta', () => {
        const v1 = calcularAssinatura({ ...base, segredo });
        expect(assinaturaValida({ xSignature: cabecalho(v1), xRequestId: base.requestId, dataId: base.dataId, segredo })).toBe(true);
    });

    test('recusa segredo errado, id adulterado, request-id adulterado e ts adulterado', () => {
        const v1 = calcularAssinatura({ ...base, segredo });
        expect(assinaturaValida({ xSignature: cabecalho(v1), xRequestId: base.requestId, dataId: base.dataId, segredo: 'outro' })).toBe(false);
        expect(assinaturaValida({ xSignature: cabecalho(v1), xRequestId: base.requestId, dataId: '999', segredo })).toBe(false);
        expect(assinaturaValida({ xSignature: cabecalho(v1), xRequestId: 'outro', dataId: base.dataId, segredo })).toBe(false);
        expect(assinaturaValida({ xSignature: cabecalho(v1, '1700000001'), xRequestId: base.requestId, dataId: base.dataId, segredo })).toBe(false);
    });

    test('recusa cabeçalho ausente, malformado, sem segredo e v1 não hexadecimal ou de tamanho errado', () => {
        const v1 = calcularAssinatura({ ...base, segredo });
        const ok = { xRequestId: base.requestId, dataId: base.dataId, segredo };
        expect(assinaturaValida({ ...ok, xSignature: undefined })).toBe(false);
        expect(assinaturaValida({ ...ok, xSignature: 'lixo' })).toBe(false);
        expect(assinaturaValida({ ...ok, xSignature: cabecalho('zz-nao-hex') })).toBe(false);
        expect(assinaturaValida({ ...ok, xSignature: cabecalho(v1.slice(0, 10)) })).toBe(false);
        expect(assinaturaValida({ ...ok, xSignature: cabecalho(v1), segredo: '' })).toBe(false);
    });
});
