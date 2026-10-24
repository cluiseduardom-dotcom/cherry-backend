const { criarUsuarioSchema, editarDadosSchema } = require('../../src/validations/usuariosValidation');
const { cpfValido } = require('../../src/utils/documentos');

const base = { nome: 'Ana', email: 'ana@x.com', senha: 'segredo1', papel: 'vendedor', telefone: '(11) 91234-5678' };

describe('cpfValido', () => {
    test('aceita CPF real e recusa dígito errado, sequência repetida e tamanho errado', () => {
        expect(cpfValido('52998224725')).toBe(true);
        expect(cpfValido('52998224724')).toBe(false);
        expect(cpfValido('11111111111')).toBe(false);
        expect(cpfValido('5299822472')).toBe(false);
        expect(cpfValido(undefined)).toBe(false);
    });
});

describe('criarUsuarioSchema (dados cadastrais)', () => {
    test('só telefone é obrigatório; normaliza máscaras e vazio vira null', () => {
        const r = criarUsuarioSchema.safeParse({ ...base, cpf: '529.982.247-25', cep: '01001-000', uf: 'sp', complemento: '  ', data_nascimento: '1990-05-10' });

        expect(r.success).toBe(true);
        expect(r.data).toMatchObject({ telefone: '11912345678', cpf: '52998224725', cep: '01001000', uf: 'SP', complemento: null, data_nascimento: '1990-05-10' });
        expect(criarUsuarioSchema.safeParse({ nome: 'A', email: 'a@x.com', senha: '123456', papel: 'vendedor' }).success).toBe(false);
    });

    test.each([
        ['telefone curto', { telefone: '1234' }],
        ['CPF inválido', { cpf: '12345678900' }],
        ['CEP inválido', { cep: '123' }],
        ['UF inexistente', { uf: 'XX' }],
        ['nascimento no futuro', { data_nascimento: '2999-01-01' }],
        ['data inválida', { data_admissao: '2026-02-30' }],
        ['observações enormes', { observacoes: 'x'.repeat(1001) }],
        ['campo desconhecido', { empresa_id: 1 }]
    ])('recusa %s', (_, extra) => {
        expect(criarUsuarioSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    });
});

describe('editarDadosSchema', () => {
    test('parcial; null limpa campo opcional, mas não o telefone', () => {
        expect(editarDadosSchema.safeParse({ cpf: null, observacoes: '' }).data).toEqual({ cpf: null, observacoes: null });
        expect(editarDadosSchema.safeParse({ telefone: null }).success).toBe(false);
        expect(editarDadosSchema.safeParse({}).success).toBe(false);
        expect(editarDadosSchema.safeParse({ papel: 'admin' }).success).toBe(false);
    });
});
