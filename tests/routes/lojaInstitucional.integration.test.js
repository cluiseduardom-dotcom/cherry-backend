// Integração de verdade (Postgres de testes): dados institucionais da loja geridos pelo ERP.
// Prova: só admin com a funcionalidade ligada edita; tudo nasce vazio; a loja pública só mostra o que está preenchido;
// validação dura de link de rede social (https e domínio da rede), CNPJ, WhatsApp e e-mail; campos ausentes não apagam
// o que já está salvo; isolamento entre empresas.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { cnpjValido } = require('../../src/validations/lojaValidation');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { slug: `teste-ins-a-${sufixo}`, nome: 'Institucional A' };
const B = { slug: `teste-ins-b-${sufixo}`, nome: 'Institucional B' };
const SEM_FLAG = { slug: `teste-ins-c-${sufixo}`, nome: 'Institucional Sem Flag' };
const CNPJ_OK = '11222333000181';

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;

async function criarEmpresa(E, { comFlag = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status, slug) VALUES ($1, 'ativa', $2) RETURNING id`, [`Teste ${E.nome} ${sufixo}`, E.slug]));
    E.usuarios = {};
    for (const papel of ['admin', 'vendedor']) {
        const id = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, 'x', $4) RETURNING id`, [E.id, papel, `${papel}-${E.id}-${sufixo}@teste.local`, papel]);
        E.usuarios[papel] = { id, token: makeToken({ id, role: papel, empresa_id: E.id, tv: 0 }) };
    }
    if (comFlag) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`, [E.id]);
    }
}

const como = (E, papel = 'admin') => ({ Authorization: `Bearer ${E.usuarios[papel].token}` });
const ler = (E, papel) => request(app).get('/loja-institucional').set(como(E, papel));
const gravar = (E, corpo, papel) => request(app).put('/loja-institucional').set(como(E, papel)).send(corpo);
const publico = (E) => request(app).get(`/loja/${E.slug}/institucional`);

beforeAll(async () => {
    await criarEmpresa(A);
    await criarEmpresa(B);
    await criarEmpresa(SEM_FLAG, { comFlag: false });
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('cnpjValido', () => {
    test('confere os dois dígitos verificadores', () => {
        expect(cnpjValido(CNPJ_OK)).toBe(true);
        expect(cnpjValido('11222333000182')).toBe(false);
        expect(cnpjValido('11111111111111')).toBe(false);
        expect(cnpjValido('123')).toBe(false);
    });
});

describe('quem pode gerir', () => {
    test('sem token 401; vendedor 403; sem a funcionalidade 403; admin 200', async () => {
        expect((await request(app).get('/loja-institucional')).status).toBe(401);
        expect((await ler(A, 'vendedor')).status).toBe(403);
        expect((await gravar(A, { historia: 'x' }, 'vendedor')).status).toBe(403);
        expect((await ler(SEM_FLAG)).status).toBe(403);
        expect((await ler(A)).status).toBe(200);
    });
});

describe('o que a loja mostra', () => {
    test('tudo nasce vazio: a gestão devolve nulos e o público devolve objeto vazio (nada inventado)', async () => {
        const g = await ler(A);
        expect(Object.values({ ...g.body.data, atualizado_em: null }).every((v) => v === null)).toBe(true);
        expect((await publico(A)).body.data).toEqual({});
    });

    test('grava e a loja pública mostra só o preenchido, com serviços em lista e redes agrupadas', async () => {
        const res = await gravar(A, {
            historia: '  Texto de TESTE da história.  ', fundadora_nome: 'Fundadora TESTE', servicos: 'Serviço TESTE 1\n\n  Serviço TESTE 2  \n',
            whatsapp: '(11) 99999-0000', email_contato: 'Contato@Teste.Local', instagram_url: 'https://www.instagram.com/perfil.teste/',
            tiktok_url: 'https://www.tiktok.com/@perfil.teste', razao_social: 'Empresa TESTE LTDA', cnpj: '11.222.333/0001-81'
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ historia: 'Texto de TESTE da história.', whatsapp: '5511999990000', email_contato: 'contato@teste.local', cnpj: CNPJ_OK });

        const pub = (await publico(A)).body.data;
        expect(pub).toMatchObject({
            historia: 'Texto de TESTE da história.', fundadora_nome: 'Fundadora TESTE', servicos: ['Serviço TESTE 1', 'Serviço TESTE 2'],
            whatsapp: '5511999990000', redes: { instagram: 'https://www.instagram.com/perfil.teste/', tiktok: 'https://www.tiktok.com/@perfil.teste' }
        });
        expect(pub.redes.facebook).toBeUndefined();
        expect(pub.atendimento).toBeUndefined();
        expect(Object.keys(pub)).not.toContain('atualizado_por');
    });

    test('campo ausente não apaga o que está salvo; null limpa', async () => {
        await gravar(A, { atendimento: 'Atendimento TESTE' });
        expect((await ler(A)).body.data).toMatchObject({ atendimento: 'Atendimento TESTE', historia: 'Texto de TESTE da história.' });

        await gravar(A, { historia: null, atendimento: '   ' });
        const dados = (await ler(A)).body.data;
        expect(dados.historia).toBeNull();
        expect(dados.atendimento).toBeNull();
        expect(dados.fundadora_nome).toBe('Fundadora TESTE');
    });

    test('uma empresa nunca vê o institucional da outra', async () => {
        expect((await ler(B)).body.data.fundadora_nome).toBeNull();
        expect((await publico(B)).body.data).toEqual({});
    });

    test('a rota pública só responde para loja ativa com a funcionalidade (404 igual aos demais)', async () => {
        expect((await request(app).get(`/loja/${SEM_FLAG.slug}/institucional`)).status).toBe(404);
        expect((await request(app).get('/loja/nao-existe/institucional')).status).toBe(404);
    });
});

describe('validação', () => {
    test.each([
        [{ instagram_url: 'http://instagram.com/x' }, /https/],
        [{ instagram_url: 'https://evil.com/instagram.com' }, /instagram\.com/],
        [{ instagram_url: 'https://instagram.com.evil.com/x' }, /instagram\.com/],
        [{ instagram_url: 'https://user:senha@instagram.com/x' }, /instagram\.com/],
        [{ instagram_url: 'javascript:alert(1)' }, /instagram\.com/],
        [{ facebook_url: 'https://instagram.com/x' }, /facebook\.com/],
        [{ tiktok_url: 'tiktok.com/@x' }, /inválido/i],
        [{ cnpj: '11222333000182' }, /CNPJ/],
        [{ whatsapp: '12345' }, /WhatsApp/],
        [{ email_contato: 'sem-arroba' }, /E-mail/],
        [{ historia: 'x'.repeat(6001) }, /6000/],
        [{ empresa_id: 99 }, /./],
        [{ preco: 10 }, /./]
    ])('rejeita %j', async (corpo, mensagem) => {
        const res = await gravar(A, corpo);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(mensagem);
    });

    test('aceita facebook em fb.com e subdomínio, e WhatsApp já com 55', async () => {
        const res = await gravar(A, { facebook_url: 'https://m.facebook.com/perfil', whatsapp: '5511988887777' });
        expect(res.status).toBe(200);
        expect(res.body.data.whatsapp).toBe('5511988887777');
    });

    test('o banco também barra WhatsApp e CNPJ fora do formato (defesa em profundidade)', async () => {
        await expect(db.query(`UPDATE loja_institucional SET whatsapp = '123' WHERE empresa_id = $1`, [A.id])).rejects.toThrow();
        await expect(db.query(`UPDATE loja_institucional SET cnpj = '1' WHERE empresa_id = $1`, [A.id])).rejects.toThrow();
    });
});
