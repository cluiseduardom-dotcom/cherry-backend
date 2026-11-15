// Integração: aviso de cobrança da plataforma no sino do ERP (GET /notificacoes). Usuários REAIS (admin e vendedor), mês
// fechado pelo operador do painel, pagamento real. O que se prova: só o administrador vê; só com a suspensão ligada; vem em
// primeiro lugar; some quando o pagamento tira a loja da suspensão; outra empresa não vê; e a resposta não vaza taxa.
jest.setTimeout(90000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { criarOperadorComSessao, removerOperador } = require('../helpers/painelSessao');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { hojeSP } = require('../../src/utils/dataSaoPaulo');

const registro = criarRegistroDeEmpresas(db);
const SUFIXO = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(12).toString('hex');

const A = {}; // R$ 25,00 do mês 2025-10 fechado: muito além da carência
const B = {}; // nenhum mês fechado
let operador;

async function criarUsuario(empresaId, papel, rotulo) {
    const email = `cobranca-${rotulo}-${papel}-${SUFIXO}@teste.invalid`;
    await db.query(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5)`,
        [empresaId, `Teste ${papel} ${rotulo}`, email, await bcrypt.hash(SENHA, 4), papel]);
    const res = await request(app).post('/auth/login').send({ email, senha: SENHA });
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.token;
}

async function montarEmpresa(alvo, rotulo) {
    const emp = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste SinoCobranca ${rotulo} ${SUFIXO}`]);
    alvo.id = registro.registrar(emp.rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.id])).rows[0].id;
    alvo.admin = await criarUsuario(alvo.id, 'admin', rotulo);
    alvo.vendedor = await criarUsuario(alvo.id, 'vendedor', rotulo);
}

async function fecharMes(alvo, competencia, taxa) {
    const politica = (await db.query('SELECT id, plano_id FROM politicas_taxa_plataforma ORDER BY id LIMIT 1')).rows[0];
    const venda = (await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, total, status, data)
         VALUES ($1, $2, 1000, 'finalizada', ($3::timestamptz) AT TIME ZONE current_setting('TimeZone')) RETURNING id`,
        [alvo.id, alvo.canalId, `${competencia}-10T15:00:00Z`]
    )).rows[0].id;
    await db.query(
        `INSERT INTO taxas_venda (venda_id, empresa_id, politica_id, plano_id, origem, tipo, percentual, base_calculo, valor, status)
         VALUES ($1, $2, $3, $4, 'padrao_sem_plano', 'percentual', 0.5, 1000, $5, 'apurada')`,
        [venda, alvo.id, politica.id, politica.plano_id, taxa]
    );
    const res = await request(app).post('/painel/taxas/periodos/fechar').set(operador.cabecalho).send({ competencia, empresa_id: alvo.id });
    if (res.status !== 200) throw new Error(`fechar: ${res.status} ${JSON.stringify(res.body)}`);
    alvo.periodoId = res.body.data.items[0].periodo_id;
}

const sino = (token) => request(app).get('/notificacoes').set('Authorization', `Bearer ${token}`);
const doTipo = (res) => res.body.data.itens.filter((i) => i.tipo === 'cobranca_plataforma');
const LIGAR = () => { process.env.COBRANCA_SUSPENSAO_PIX = 'ligada'; };
const DESLIGAR = () => { delete process.env.COBRANCA_SUSPENSAO_PIX; };

async function removerTrilhaDasEmpresas(ids) {
    const c = await db.connect();
    try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL vertumno.limpeza_teste = 'on'`);
        await c.query('DELETE FROM plataforma_eventos WHERE alvo_empresa_id = ANY($1::int[])', [ids]);
        await c.query('COMMIT');
    } catch (erro) {
        await c.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        c.release();
    }
}

beforeAll(async () => {
    DESLIGAR();
    operador = await criarOperadorComSessao('sinocobranca');
    await montarEmpresa(A, 'A');
    await montarEmpresa(B, 'B');
    await fecharMes(A, '2025-10', 25);
});

afterEach(DESLIGAR);

afterAll(async () => {
    DESLIGAR();
    try {
        await removerTrilhaDasEmpresas(registro.ids());
        await registro.limpar();
        await removerOperador(operador);
    } finally {
        await db.end();
    }
});

describe('GET /notificacoes — aviso de cobrança da plataforma', () => {
    test('suspensão desligada (padrão): ninguém recebe, nem o administrador', async () => {
        expect(doTipo(await sino(A.admin))).toEqual([]);
    });

    test('ligada e Pix suspenso: o administrador recebe, em primeiro lugar, com valor e sem vazar taxa', async () => {
        LIGAR();
        const res = await sino(A.admin);

        expect(res.status).toBe(200);
        expect(res.body.data.itens[0]).toMatchObject({
            tipo: 'cobranca_plataforma', prioridade: 'alta', titulo: 'Pix da loja suspenso', item: 'cobranca',
            id: 'cobranca_plataforma:suspenso:2025-11-21', dados: { saldo_vencido: 25, suspensao_em: '2025-11-21' }
        });
        expect(res.body.data.itens[0].mensagem).toMatch(/suspenso por uma pendência de R\$\s25,00 com a GiroNex/);
        expect(res.body.data.total).toBe(res.body.data.itens.length);
        expect(JSON.stringify(res.body)).not.toMatch(/percentual|0\.5000|taxas_venda|pix_manual/i);
    });

    test('vendedor da MESMA loja não recebe', async () => {
        LIGAR();
        expect(doTipo(await sino(A.vendedor))).toEqual([]);
    });

    test('outra empresa (sem mês fechado) não recebe, nem o administrador dela', async () => {
        LIGAR();
        expect(doTipo(await sino(B.admin))).toEqual([]);
    });

    test('pagar tira a loja da suspensão e o aviso some, sem rotina nenhuma', async () => {
        LIGAR();
        expect(doTipo(await sino(A.admin))).toHaveLength(1);

        const pago = await request(app).post(`/painel/taxas/periodos/${A.periodoId}/pagamentos`).set(operador.cabecalho)
            .send({ valor: 20, data_pagamento: hojeSP(), forma_pagamento: 'pix' });
        expect(pago.status).toBe(201); // sobram R$ 5,00, abaixo do piso

        expect(doTipo(await sino(A.admin))).toEqual([]);
    });
});
