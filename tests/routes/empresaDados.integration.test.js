// Integração de verdade: GET/PATCH /empresa/dados (admin), isolamento por empresa e RBAC.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { cnpjValido } = require('../../src/utils/documentos');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);
const A = { u: {} };
const B = { u: {} };

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Empresa ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    for (const papel of ['admin', 'vendedor', 'estoquista']) {
        alvo.u[papel] = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH, papel]
        )).rows[0].id;
    }
}

const tk = (alvo, papel) => makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 });
const get = (alvo, papel) => request(app).get('/empresa/dados').set('Authorization', `Bearer ${tk(alvo, papel)}`);
const patch = (alvo, corpo, papel = 'admin') => request(app).patch('/empresa/dados').set('Authorization', `Bearer ${tk(alvo, papel)}`).send(corpo);

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('cnpjValido', () => {
    test('aceita CNPJ real e recusa dígito errado, repetido e tamanho', () => {
        expect(cnpjValido('11222333000181')).toBe(true);
        expect(cnpjValido('11222333000182')).toBe(false);
        expect(cnpjValido('11111111111111')).toBe(false);
        expect(cnpjValido('123')).toBe(false);
    });
});

describe('/empresa/dados', () => {
    test('só admin: vendedor e estoquista recebem 403; sem token, 401', async () => {
        expect((await get(A, 'vendedor')).status).toBe(403);
        expect((await get(A, 'estoquista')).status).toBe(403);
        expect((await patch(A, { telefone: '11999998888' }, 'vendedor')).status).toBe(403);
        expect((await request(app).get('/empresa/dados')).status).toBe(401);
    });

    test('admin lê os dados da própria empresa', async () => {
        const res = await get(A, 'admin');
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id: A.empresaId, nome: `Teste Empresa A ${sufixo}`, cnpj: null, telefone: null });
    });

    test('atualização parcial normaliza dígitos e mantém o resto', async () => {
        const res = await patch(A, { cnpj: '11.222.333/0001-81', telefone: '(11) 99999-8888', cidade: 'São Paulo', uf: 'sp', cep: '01310-100' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ cnpj: '11222333000181', telefone: '11999998888', cidade: 'São Paulo', uf: 'SP', cep: '01310100', nome: `Teste Empresa A ${sufixo}` });

        const limpar = await patch(A, { cidade: '' });
        expect(limpar.body.data.cidade).toBeNull();
        expect(limpar.body.data.cnpj).toBe('11222333000181');

        const { rows } = await db.query('SELECT atualizado_por FROM empresas WHERE id = $1', [A.empresaId]);
        expect(rows[0].atualizado_por).toBe(A.u.admin);
    });

    test('validações: CNPJ, UF, e-mail, nome vazio, corpo vazio e campos proibidos', async () => {
        expect((await patch(A, { cnpj: '11222333000182' })).status).toBe(400);
        expect((await patch(A, { uf: 'XX' })).status).toBe(400);
        expect((await patch(A, { email_contato: 'nao-e-email' })).status).toBe(400);
        expect((await patch(A, { nome: '' })).status).toBe(400);
        expect((await patch(A, {})).status).toBe(400);
        expect((await patch(A, { empresa_id: B.empresaId })).status).toBe(400);
        expect((await patch(A, { status: 'inativa' })).status).toBe(400);
    });

    test('isolamento: editar A nunca altera B', async () => {
        const b = await get(B, 'admin');
        expect(b.body.data).toMatchObject({ id: B.empresaId, cnpj: null, telefone: null, cidade: null });
    });
});
