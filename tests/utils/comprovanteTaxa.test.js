const { detectarTipo, montarChave, chaveDoPeriodo, tipoDaChave } = require('../../src/utils/comprovanteTaxa');

describe('comprovante da taxa — regras puras', () => {
    test('tipo pelo conteúdo: PDF, JPEG e PNG; o resto é recusado', () => {
        expect(detectarTipo(Buffer.from('%PDF-1.7\nxxxx'))).toBe('application/pdf');
        expect(detectarTipo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe('image/jpeg');
        expect(detectarTipo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
        expect(detectarTipo(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
        expect(detectarTipo(Buffer.from('%PDF'))).toBeNull();
        expect(detectarTipo('não é buffer')).toBeNull();
    });

    test('chave presa à empresa e ao período; nada fora do formato passa', () => {
        const uuid = '0b0f6d2c-1a2b-4c3d-8e9f-0123456789ab';
        const chave = montarChave({ empresa_id: 7, periodo_id: 30, uuid, extensao: 'pdf' });
        expect(chave).toBe(`taxas/7/30/${uuid}.pdf`);
        expect(chaveDoPeriodo(chave, { empresa_id: 7, periodo_id: 30 })).toBe(true);
        expect(chaveDoPeriodo(chave, { empresa_id: 8, periodo_id: 30 })).toBe(false);
        expect(chaveDoPeriodo(chave, { empresa_id: 7, periodo_id: 31 })).toBe(false);
        expect(chaveDoPeriodo(`taxas/7/30/../${uuid}.pdf`, { empresa_id: 7, periodo_id: 30 })).toBe(false);
        expect(chaveDoPeriodo(`taxas/7/30/${uuid}.exe`, { empresa_id: 7, periodo_id: 30 })).toBe(false);
        expect(tipoDaChave(chave)).toBe('application/pdf');
    });
});
