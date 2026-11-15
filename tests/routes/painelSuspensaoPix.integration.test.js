// Integração: suspensão do Pix por taxa em atraso (etapa 5, parte 2). Vendas REAIS pela API do ERP, cobrança Pix real
// (rota -> serviço -> Postgres), operador do painel e trilha reais. O que se prova:
//  - ligada e com o mês fechado passado da carência (e saldo >= piso), o Pix é recusado NO BACKEND, com 403 e sem efeito colateral;
//  - 403, nunca 409 (o PDV lê 409 como "Mercado Pago indisponível" e cairia sozinho para o Pix manual);
//  - dinheiro, débito e Pix JÁ PAGO pelo Mercado Pago continuam (o dinheiro entrou, a venda precisa registrar);
//  - pagar reativa na hora; abaixo do piso, sem mês fechado e desligada (padrão) nunca suspendem;
//  - a mensagem não cita taxa, valor nem motivo.
jest.setTimeout(90000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { criarOperadorComSessao, removerOperador } = require('../helpers/painelSessao');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { darEstoqueInicial } = require('../helpers/estoqueInicial');
const { hojeSP } = require('../../src/utils/dataSaoPaulo');

const registro = criarRegistroDeEmpresas(db);
const SUFIXO = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(12).toString('hex');
const PRECO = 120;

const A = {}; // R$ 25,00 do mês 2025-10 fechado: muito além da carência (suspende quando ligada)
const B = {}; // nenhum mês fechado
const C = {}; // R$ 6,00 do mês 2025-10 fechado: abaixo do piso
let operador;

async function montarEmpresa(alvo, rotulo) {
    const emp = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste SuspPix ${rotulo} ${SUFIXO}`]);
    alvo.id = registro.registrar(emp.rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.id])).rows[0].id;

    const email = `susppix-${rotulo}-${SUFIXO}@teste.invalid`;
    alvo.usuarioId = (await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin') RETURNING id`,
        [alvo.id, `Teste admin ${rotulo}`, email, await bcrypt.hash(SENHA, 4)]
    )).rows[0].id;
    const login = await request(app).post('/auth/login').send({ email, senha: SENHA });
    if (login.status !== 200) throw new Error(`login: ${login.status} ${JSON.stringify(login.body)}`);
    alvo.token = login.body.data.token;

    const prod = await request(app).post('/produtos').set('Authorization', `Bearer ${alvo.token}`)
        .send({ nome: `Peça ${rotulo}`, preco_venda: PRECO, custo: 0.5, estoque_minimo: 1 });
    if (prod.status !== 201) throw new Error(`produto: ${prod.status} ${JSON.stringify(prod.body)}`);
    alvo.produtoId = prod.body.data.id;
    await darEstoqueInicial(app, alvo.token, alvo.produtoId, 50);
    const preco = await request(app).put(`/produtos/${alvo.produtoId}/precos/${alvo.canalId}`).set('Authorization', `Bearer ${alvo.token}`).send({ preco_venda: PRECO });
    if (preco.status !== 201) throw new Error(`preço: ${preco.status} ${JSON.stringify(preco.body)}`);
}

// Mês fechado pelo operador, com a taxa pedida (venda antiga + taxa congelada, como o PDV gravaria).
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

const vender = (alvo, pagamentos) => request(app).post('/vendas').set('Authorization', `Bearer ${alvo.token}`)
    .send({ canal: 'loja_fisica', itens: [{ produto_id: alvo.produtoId, quantidade: 1 }], pagamentos });
const pix = (extra = {}) => [{ forma_pagamento: 'pix', valor: PRECO, ...extra }];
const criarCobrancaPix = (alvo) => request(app).post('/pagamentos-gateway/pix').set('Authorization', `Bearer ${alvo.token}`).send({ valor: 50 });
const estoque = async (alvo) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [alvo.produtoId])).rows[0].estoque_atual;
const contarVendas = async (alvo) => Number((await db.query('SELECT COUNT(*) FROM vendas WHERE empresa_id = $1', [alvo.id])).rows[0].count);
const pagarTaxa = (alvo, valor) => request(app).post(`/painel/taxas/periodos/${alvo.periodoId}/pagamentos`).set(operador.cabecalho)
    .send({ valor, data_pagamento: hojeSP(), forma_pagamento: 'pix' });

async function cobrancaPaga(alvo) {
    const codigo = crypto.randomUUID();
    await db.query(
        `INSERT INTO cobrancas_pagamento (codigo, empresa_id, valor, metodo, status, criado_por, id_externo)
         VALUES ($1, $2, $3, 'pix', 'pago', $4, $5)`,
        [codigo, alvo.id, PRECO, alvo.usuarioId, `mp-${crypto.randomBytes(4).toString('hex')}`]
    );
    return codigo;
}

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

const LIGAR = () => { process.env.COBRANCA_SUSPENSAO_PIX = 'ligada'; };
const DESLIGAR = () => { delete process.env.COBRANCA_SUSPENSAO_PIX; };

beforeAll(async () => {
    DESLIGAR();
    operador = await criarOperadorComSessao('suspensao');
    await montarEmpresa(A, 'A');
    await montarEmpresa(B, 'B');
    await montarEmpresa(C, 'C');
    await fecharMes(A, '2025-10', 25);
    await fecharMes(C, '2025-10', 6);
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

describe('desligada (padrão)', () => {
    test('mesmo com o mês passado da carência, nada é suspenso: o Pix manual vende', async () => {
        expect((await vender(A, pix())).status).toBe(201);
    });

    test('a lista de atrasos mostra "deveria estar suspenso" e a chave desligada', async () => {
        const res = await request(app).get('/painel/taxas/ciclo').set(operador.cabecalho);
        const a = res.body.data.items.find((i) => i.empresa_id === A.id);
        expect(res.body.data.config.suspensao_ativa).toBe(false);
        expect(a).toMatchObject({ estagio: 'suspensao_devida', suspender: true, pix_suspenso: false });
    });
});

describe('ligada: loja suspensa (R$ 25,00 de um mês fechado muito além da carência)', () => {
    test('Pix manual é RECUSADO no backend (403), sem efeito colateral e sem citar taxa, valor ou motivo', async () => {
        LIGAR();
        const antes = { estoque: await estoque(A), vendas: await contarVendas(A) };
        const res = await vender(A, pix());

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/O Pix está indisponível para esta empresa no momento/);
        expect(res.body.message).not.toMatch(/taxa|atraso|pagamento|R\$|25|vencid|bloque|sinaliz/i);
        expect(await estoque(A)).toBe(antes.estoque);
        expect(await contarVendas(A)).toBe(antes.vendas);
    });

    test('criar cobrança Pix no Mercado Pago: 403 (NUNCA 409, que o PDV leria como "Mercado Pago indisponível")', async () => {
        LIGAR();
        const res = await criarCobrancaPix(A);
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/O Pix está indisponível/);

        // Loja não suspensa, neste ambiente sem Mercado Pago: 409 (o fallback de sempre do PDV continua intacto).
        const deB = await criarCobrancaPix(B);
        expect(deB.status).toBe(409);
        expect(deB.body.message).toMatch(/Mercado Pago não está configurada/);
    });

    test('dinheiro e débito continuam (só o Pix é atingido)', async () => {
        LIGAR();
        expect((await vender(A, [{ forma_pagamento: 'dinheiro', valor: PRECO }])).status).toBe(201);
        expect((await vender(A, [{ forma_pagamento: 'debito', valor: PRECO }])).status).toBe(201);
    });

    test('Pix JÁ PAGO pelo Mercado Pago continua registrável: o dinheiro entrou e a venda tem de existir', async () => {
        LIGAR();
        const codigo = await cobrancaPaga(A);
        const res = await vender(A, pix({ cobranca_codigo: codigo }));
        expect(res.status).toBe(201);

        const { rows } = await db.query('SELECT origem FROM pagamentos_venda WHERE venda_id = $1', [res.body.data.id]);
        expect(rows).toEqual([{ origem: 'gateway' }]);
    });

    test('a lista de atrasos passa a mostrar o Pix suspenso, desde quando e quantas lojas', async () => {
        LIGAR();
        const res = await request(app).get('/painel/taxas/ciclo').set(operador.cabecalho);
        const a = res.body.data.items.find((i) => i.empresa_id === A.id);
        expect(res.body.data.config.suspensao_ativa).toBe(true);
        expect(a).toMatchObject({ pix_suspenso: true, suspender: true, suspensao_em: '2025-11-21' });
        expect(res.body.data.totais.pix_suspenso).toBeGreaterThanOrEqual(1);
    });
});

describe('ligada: quem NÃO é suspenso', () => {
    test('loja sem mês fechado', async () => {
        LIGAR();
        expect((await vender(B, pix())).status).toBe(201);
    });

    test('loja com saldo abaixo do piso (R$ 6,00), mesmo muito depois', async () => {
        LIGAR();
        expect((await vender(C, pix())).status).toBe(201);
    });
});

describe('reativação ao pagar', () => {
    test('o pagamento que leva o saldo vencido abaixo do piso reativa o Pix na hora, sem rotina nenhuma', async () => {
        LIGAR();
        expect((await vender(A, pix())).status).toBe(403);

        // paga R$ 20,00 dos R$ 25,00: sobram R$ 5,00, abaixo do piso de R$ 10,00
        expect((await pagarTaxa(A, 20)).status).toBe(201);
        expect((await vender(A, pix())).status).toBe(201);
        expect((await criarCobrancaPix(A)).status).toBe(409); // chegou ao Mercado Pago (que aqui não está configurado): o 403 saiu

        const a = (await request(app).get('/painel/taxas/ciclo').set(operador.cabecalho)).body.data.items.find((i) => i.empresa_id === A.id);
        expect(a).toMatchObject({ estagio: 'abaixo_do_piso', pix_suspenso: false, saldo_vencido: 5 });
    });
});
