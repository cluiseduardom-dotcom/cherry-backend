const {
    criarTransferenciaSchema, aceitarSchema, recusarOuCancelarSchema, criarLocalSchema, listarTransferenciasSchema
} = require('../../src/validations/transferenciasEstoqueValidation');

const base = { origem_local_id: 1, destino_local_id: 2, itens: [{ produto_id: 5, quantidade: 3 }] };
const erro = (schema, dados) => { const r = schema.safeParse(dados); return r.success ? null : r.error.issues[0].message; };

describe('criarTransferenciaSchema', () => {
    test('aceita o corpo válido e converte números em texto', () => {
        const r = criarTransferenciaSchema.parse({ ...base, origem_local_id: '1', itens: [{ produto_id: '5', quantidade: '3' }], observacao: '  teste  ' });
        expect(r).toEqual({ origem_local_id: 1, destino_local_id: 2, itens: [{ produto_id: 5, quantidade: 3 }], observacao: 'teste' });
    });

    test.each([
        [{ ...base, destino_local_id: 1 }, 'Origem e destino devem ser diferentes'],
        [{ ...base, itens: [] }, 'Informe ao menos um item'],
        [{ ...base, itens: [{ produto_id: 5, quantidade: 1 }, { produto_id: 5, quantidade: 2 }] }, 'Produto repetido nos itens'],
        [{ ...base, itens: [{ produto_id: 5, quantidade: 0 }] }, 'Quantidade inválido'],
        [{ ...base, itens: [{ produto_id: 5, quantidade: 1.5 }] }, 'Quantidade inválido'],
        [{ ...base, itens: [{ produto_id: 5, quantidade: 1000001 }] }, 'Quantidade muito alta'],
        [{ ...base, itens: Array.from({ length: 201 }, (_, i) => ({ produto_id: i + 1, quantidade: 1 })) }, 'Máximo de 200 itens por transferência'],
        [{ ...base, observacao: 'x'.repeat(501) }, 'Observação muito longa'],
    ])('recusa %#', (dados, mensagem) => {
        expect(erro(criarTransferenciaSchema, dados)).toBe(mensagem);
    });

    test('campos fora do contrato (empresa_id, status, criado_por) são recusados', () => {
        expect(criarTransferenciaSchema.safeParse({ ...base, empresa_id: 9 }).success).toBe(false);
        expect(criarTransferenciaSchema.safeParse({ ...base, status: 'concluida' }).success).toBe(false);
        expect(criarTransferenciaSchema.safeParse({ ...base, itens: [{ produto_id: 5, quantidade: 1, custo: 1 }] }).success).toBe(false);
    });
});

describe('aceitar / recusar / cancelar', () => {
    test('aceitar não recebe corpo; recusar e cancelar exigem motivo de 3 a 300 caracteres', () => {
        expect(aceitarSchema.safeParse({}).success).toBe(true);
        expect(aceitarSchema.safeParse({ motivo: 'x' }).success).toBe(false);
        expect(erro(recusarOuCancelarSchema, {})).toBe('Motivo é obrigatório');
        expect(erro(recusarOuCancelarSchema, { motivo: ' ab ' })).toBe('Motivo deve ter ao menos 3 caracteres');
        expect(erro(recusarOuCancelarSchema, { motivo: 'x'.repeat(301) })).toBe('Motivo muito longo');
        expect(recusarOuCancelarSchema.parse({ motivo: '  Peças erradas ' })).toEqual({ motivo: 'Peças erradas' });
    });
});

describe('criarLocalSchema', () => {
    test('maleta exige usuário; consignado exige nome; central e trânsito não são criáveis', () => {
        expect(criarLocalSchema.parse({ tipo: 'maleta', usuario_id: '4' })).toEqual({ tipo: 'maleta', usuario_id: 4 });
        expect(criarLocalSchema.safeParse({ tipo: 'maleta' }).success).toBe(false);
        expect(criarLocalSchema.parse({ tipo: 'consignado', nome: ' Revenda ', cliente_id: 3 })).toEqual({ tipo: 'consignado', nome: 'Revenda', cliente_id: 3 });
        expect(criarLocalSchema.safeParse({ tipo: 'consignado' }).success).toBe(false);
        expect(criarLocalSchema.safeParse({ tipo: 'central' }).success).toBe(false);
        expect(criarLocalSchema.safeParse({ tipo: 'transito' }).success).toBe(false);
        expect(criarLocalSchema.safeParse({ tipo: 'maleta', usuario_id: 1, empresa_id: 2 }).success).toBe(false);
    });
});

describe('listarTransferenciasSchema', () => {
    test('status opcional dentro da lista', () => {
        expect(listarTransferenciasSchema.safeParse({}).success).toBe(true);
        expect(listarTransferenciasSchema.safeParse({ status: 'pendente' }).success).toBe(true);
        expect(listarTransferenciasSchema.safeParse({ status: 'qualquer' }).success).toBe(false);
    });
});
