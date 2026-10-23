// Integração de verdade (Postgres da CI/dev, sem mock de sessão): migration 052 + política de cancelamento
// por faixa de idade + autorizador por senha + registro imutável + histórico, pelo HTTP completo.
// Empresas, usuários e vendas próprios e temporários; remove tudo no fim.
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');
const { CATALOGO } = require('../../src/constants/cargos');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(10).toString('hex');
const SENHA_HASH = bcrypt.hashSync(SENHA, 4);
const MOTIVO = 'Cliente desistiu da compra';

const A = { u: {} }; // comércio completo
const B = { u: {} }; // outro comércio (isolamento)
const C = { u: {} }; // hierarquia reordenada

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Cancelamento ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome) VALUES ($1, 'Loja') RETURNING id`, [alvo.empresaId])).rows[0].id;
}

async function criarUsuario(alvo, papel, rotulo = papel) {
    const email = `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`;
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, email, SENHA_HASH, papel]
    );
    alvo.u[rotulo] = { id: rows[0].id, email };
}

// Liga o cargo no comércio (cargos opcionais nascem desligados) com o nível e as capacidades dados.
const ligarCargo = (alvo, cargo, nivel, capacidades) => db.query(
    `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades) VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (empresa_id, cargo) DO UPDATE SET nivel = $3, ativo = true, capacidades = $4`,
    [alvo.empresaId, cargo, nivel, capacidades]
);

// O JWT diz sempre "vendedor" de propósito: quem vale é o banco.
const tokenDe = (alvo, rotulo) => makeToken({ id: alvo.u[rotulo].id, role: 'vendedor', empresa_id: alvo.empresaId, tv: 0 });
const auth = (alvo, rotulo) => ({ Authorization: `Bearer ${tokenDe(alvo, rotulo)}` });
const credencial = (alvo, rotulo) => ({ email: alvo.u[rotulo].email, senha: SENHA });

const cancelar = (alvo, rotulo, vendaId, corpo = { motivo: MOTIVO }) =>
    request(app).patch(`/vendas/${vendaId}/cancelar`).set(auth(alvo, rotulo)).send(corpo);

async function criarProduto(alvo, estoque = 10) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, 50, 20, $3) RETURNING id`,
        [alvo.empresaId, `Produto ${sufixo}`, estoque]
    );

    return rows[0].id;
}

// `idade` em SQL: '3 days', '7 days 23 hours', '8 days'... A venda nasce com a data no passado.
async function criarVenda(alvo, rotuloVendedor, idade, { quantidade = 2, preco = 50, formaPagamento = 'a_vista', pagamentos = [] } = {}) {
    const produtoId = await criarProduto(alvo);
    const total = quantidade * preco;
    const { rows } = await db.query(
        `INSERT INTO vendas (empresa_id, canal_id, usuario_id, status, total, forma_pagamento, data)
         VALUES ($1, $2, $3, 'finalizada', $4, $5, NOW() - $6::interval) RETURNING id`,
        [alvo.empresaId, alvo.canalId, alvo.u[rotuloVendedor].id, total, formaPagamento, idade]
    );
    const vendaId = rows[0].id;

    await db.query(
        `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario) VALUES ($1, $2, $3, $4, $5, 20)`,
        [alvo.empresaId, vendaId, produtoId, quantidade, preco]
    );

    for (const valor of pagamentos) {
        await db.query(
            `INSERT INTO pagamentos_venda (venda_id, empresa_id, forma_pagamento, valor, status, usuario_id) VALUES ($1, $2, 'pix', $3, 'pago', $4)`,
            [vendaId, alvo.empresaId, valor, alvo.u[rotuloVendedor].id]
        );
    }

    return { vendaId, produtoId, quantidade, total };
}

const estoqueDe = async (produtoId) => (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId])).rows[0].estoque_atual;
const statusDe = async (vendaId) => (await db.query('SELECT status FROM vendas WHERE id = $1', [vendaId])).rows[0].status;
const registros = async (vendaId) => (await db.query('SELECT * FROM cancelamentos_venda WHERE venda_id = $1', [vendaId])).rows;

// Confere que a recusa não deixou rastro: venda continua finalizada, estoque intacto, nada gravado.
async function expectIntacta(venda) {
    expect(await statusDe(venda.vendaId)).toBe('finalizada');
    expect(await estoqueDe(venda.produtoId)).toBe(10);
    expect(await registros(venda.vendaId)).toHaveLength(0);
}

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
    await criarEmpresa(C, 'C');

    for (const papel of ['admin', 'vendedor', 'supervisor', 'coordenador', 'gerente', 'analista', 'estoquista']) {
        await criarUsuario(A, papel);
    }
    await criarUsuario(A, 'vendedor', 'vendedor2');
    await criarUsuario(B, 'gerente');
    await criarUsuario(B, 'vendedor');
    await criarUsuario(C, 'vendedor');
    await criarUsuario(C, 'supervisor');
    await criarUsuario(C, 'coordenador');
    await criarUsuario(C, 'analista');
    await criarUsuario(C, 'gerente');

    // Comércio A: escada completa nos níveis padrão. Supervisor e acima veem tudo e o histórico.
    await ligarCargo(A, 'supervisor', 50, ['ver_vendas_de_todos', 'cancelar_venda', 'ver_cancelamentos']);
    await ligarCargo(A, 'coordenador', 60, ['ver_vendas_de_todos', 'cancelar_venda', 'ver_cancelamentos']);
    await ligarCargo(A, 'gerente', 70, ['ver_custos', 'ver_vendas_de_todos', 'cancelar_venda', 'ver_cancelamentos']);
    await ligarCargo(A, 'analista', 40, ['cancelar_venda']);
    await ligarCargo(B, 'gerente', 70, ['ver_vendas_de_todos', 'cancelar_venda', 'ver_cancelamentos']);

    // Comércio C: hierarquia diferente da padrão. Supervisor (55) ACIMA do Coordenador (45) e o Analista
    // (60) acima dos dois. O piso da faixa 8–30 dias é o nível do Supervisor DESTE comércio (55).
    await ligarCargo(C, 'supervisor', 55, ['cancelar_venda']);
    await ligarCargo(C, 'coordenador', 45, ['cancelar_venda']);
    await ligarCargo(C, 'analista', 60, ['cancelar_venda']);
    await ligarCargo(C, 'gerente', 70, ['ver_vendas_de_todos', 'cancelar_venda']);
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

describe('migration 052: registro imutável', () => {
    test('as faixas e a regra de autorização são constraints do banco', async () => {
        const venda = await criarVenda(A, 'vendedor', '1 day');
        const insere = (faixa, autorizadoPor, autorizadoLogin) => db.query(
            `INSERT INTO cancelamentos_venda (empresa_id, venda_id, motivo, cancelado_por, cancelado_por_login, autorizado_por, autorizado_por_login,
                                              faixa_aplicada, dias_da_venda, quantidade_devolvida, valor_devolvido)
             VALUES ($1, $2, 'teste de constraint', $3, 'x@y.z', $4, $5, $6, 1, 1, 1)`,
            [A.empresaId, venda.vendaId, A.u.vendedor.id, autorizadoPor, autorizadoLogin, faixa]
        );

        await expect(insere('qualquer', null, null)).rejects.toMatchObject({ code: '23514' });
        // Faixa livre não tem autorizador; faixa com autorização exige um.
        await expect(insere('ate_7_dias', A.u.gerente.id, 'g@x.z')).rejects.toMatchObject({ code: '23514' });
        await expect(insere('8_a_30_dias', null, null)).rejects.toMatchObject({ code: '23514' });
    });

    test('UPDATE e DELETE são recusados pelo banco; INSERT duplicado da mesma venda também', async () => {
        const venda = await criarVenda(A, 'vendedor', '1 day');
        expect((await cancelar(A, 'vendedor', venda.vendaId)).status).toBe(200);
        const [linha] = await registros(venda.vendaId);

        await expect(db.query(`UPDATE cancelamentos_venda SET motivo = 'adulterado' WHERE id = $1`, [linha.id])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query('DELETE FROM cancelamentos_venda WHERE id = $1', [linha.id])).rejects.toMatchObject({ code: '23001' });
        await expect(db.query(
            `INSERT INTO cancelamentos_venda (empresa_id, venda_id, motivo, cancelado_por, cancelado_por_login, faixa_aplicada, dias_da_venda, quantidade_devolvida, valor_devolvido)
             VALUES ($1, $2, 'duplicado', $3, 'x@y.z', 'ate_7_dias', 1, 1, 1)`, [A.empresaId, venda.vendaId, A.u.vendedor.id]
        )).rejects.toMatchObject({ code: '23505' });

        expect((await registros(venda.vendaId))[0].motivo).toBe(MOTIVO);
    });
});

describe('faixa livre (até 7 dias)', () => {
    test('Vendedor cancela a própria venda de 3 dias só com o motivo: grava tudo e devolve o estoque', async () => {
        const venda = await criarVenda(A, 'vendedor', '3 days', { quantidade: 2, preco: 50 });

        const res = await cancelar(A, 'vendedor', venda.vendaId);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id: venda.vendaId, status: 'cancelada' });
        expect(await statusDe(venda.vendaId)).toBe('cancelada');
        expect(await estoqueDe(venda.produtoId)).toBe(12);

        const [linha] = await registros(venda.vendaId);
        expect(linha).toMatchObject({
            empresa_id: A.empresaId, motivo: MOTIVO, cancelado_por: A.u.vendedor.id, cancelado_por_login: A.u.vendedor.email,
            autorizado_por: null, autorizado_por_login: null, faixa_aplicada: 'ate_7_dias', dias_da_venda: 3, quantidade_devolvida: 2
        });
        expect(Number(linha.valor_devolvido)).toBe(100); // venda à vista legada: devolve o total
        expect(linha.cancelado_em).toBeInstanceOf(Date);
        expect(res.body.data.cancelamento).toMatchObject({ id: Number(linha.id), faixa_aplicada: 'ate_7_dias' });
    });

    test('o limite: 7 dias e 23 horas ainda é livre; 8 dias já pede autorização', async () => {
        const noLimite = await criarVenda(A, 'vendedor', '7 days 23 hours');
        const passou = await criarVenda(A, 'vendedor', '8 days');

        expect((await cancelar(A, 'vendedor', noLimite.vendaId)).status).toBe(200);
        expect((await registros(noLimite.vendaId))[0]).toMatchObject({ faixa_aplicada: 'ate_7_dias', dias_da_venda: 7 });

        const recusada = await cancelar(A, 'vendedor', passou.vendaId);
        expect(recusada.status).toBe(403);
        expect(recusada.body.message).toBe('Esta venda exige autorização de Supervisor ou superior');
        await expectIntacta(passou);
    });

    test('sem motivo, motivo curto ou campo estranho: 400 e nada muda', async () => {
        const venda = await criarVenda(A, 'vendedor', '1 day');

        for (const corpo of [{}, { motivo: '  ' }, { motivo: 'abc' }, { motivo: MOTIVO, empresa_id: B.empresaId }]) {
            expect((await cancelar(A, 'vendedor', venda.vendaId, corpo)).status).toBe(400);
        }
        await expectIntacta(venda);
    });

    test('valor devolvido = estornos gerados quando a venda tem pagamentos', async () => {
        const venda = await criarVenda(A, 'vendedor', '2 days', { quantidade: 2, preco: 50, pagamentos: [60, 40] });

        expect((await cancelar(A, 'vendedor', venda.vendaId)).status).toBe(200);

        expect(Number((await registros(venda.vendaId))[0].valor_devolvido)).toBe(100);
        const estornos = await db.query('SELECT valor FROM estornos_pagamento WHERE empresa_id = $1 ORDER BY valor', [A.empresaId]);
        expect(estornos.rows.map((e) => Number(e.valor))).toEqual(expect.arrayContaining([40, 60]));
    });
});

describe('8 a 30 dias: senha de Supervisor ou acima', () => {
    test('sem autorização, com Analista (abaixo), com senha errada e com gerente de OUTRO comércio: todos 403 e nada muda', async () => {
        const venda = await criarVenda(A, 'vendedor', '10 days');

        const tentativas = [
            undefined,
            credencial(A, 'analista'),
            { ...credencial(A, 'supervisor'), senha: 'senha-errada' },
            { email: 'ninguem@teste.invalid', senha: SENHA },
            credencial(B, 'gerente')
        ];

        for (const autorizacao of tentativas) {
            const res = await cancelar(A, 'vendedor', venda.vendaId, { motivo: MOTIVO, ...(autorizacao ? { autorizacao } : {}) });
            expect(res.status).toBe(403);
        }
        await expectIntacta(venda);
    });

    test('Vendedor não autoriza o próprio cancelamento; com a senha do Supervisor passa e grava o autorizador', async () => {
        const venda = await criarVenda(A, 'vendedor', '10 days');

        const proprio = await cancelar(A, 'vendedor', venda.vendaId, { motivo: MOTIVO, autorizacao: credencial(A, 'vendedor') });
        expect(proprio.status).toBe(403);

        const res = await cancelar(A, 'vendedor', venda.vendaId, { motivo: MOTIVO, autorizacao: credencial(A, 'supervisor') });
        expect(res.status).toBe(200);
        expect(await estoqueDe(venda.produtoId)).toBe(12);
        expect((await registros(venda.vendaId))[0]).toMatchObject({
            cancelado_por: A.u.vendedor.id, autorizado_por: A.u.supervisor.id, autorizado_por_login: A.u.supervisor.email,
            faixa_aplicada: '8_a_30_dias', dias_da_venda: 10
        });
    });

    test('o e-mail do autorizador não diferencia maiúsculas de minúsculas e Admin autoriza', async () => {
        const venda = await criarVenda(A, 'vendedor', '30 days');

        const res = await cancelar(A, 'vendedor', venda.vendaId, {
            motivo: MOTIVO, autorizacao: { email: A.u.admin.email.toUpperCase(), senha: SENHA }
        });

        expect(res.status).toBe(200);
        expect((await registros(venda.vendaId))[0]).toMatchObject({ autorizado_por: A.u.admin.id, faixa_aplicada: '8_a_30_dias', dias_da_venda: 30 });
    });
});

describe('acima de 30 dias: senha de Gerente ou acima', () => {
    test('Supervisor e Coordenador não bastam; Gerente passa', async () => {
        const venda = await criarVenda(A, 'vendedor', '31 days');

        for (const autorizador of ['supervisor', 'coordenador']) {
            const res = await cancelar(A, 'vendedor', venda.vendaId, { motivo: MOTIVO, autorizacao: credencial(A, autorizador) });
            expect(res.status).toBe(403);
        }
        await expectIntacta(venda);

        const res = await cancelar(A, 'vendedor', venda.vendaId, { motivo: MOTIVO, autorizacao: credencial(A, 'gerente') });
        expect(res.status).toBe(200);
        expect((await registros(venda.vendaId))[0]).toMatchObject({ autorizado_por: A.u.gerente.id, faixa_aplicada: 'acima_30_dias', dias_da_venda: 31 });
    });

    test('o próprio Gerente cancela com a própria senha como autorização', async () => {
        const venda = await criarVenda(A, 'vendedor', '90 days');

        const sem = await cancelar(A, 'gerente', venda.vendaId);
        expect(sem.status).toBe(403);

        const res = await cancelar(A, 'gerente', venda.vendaId, { motivo: MOTIVO, autorizacao: credencial(A, 'gerente') });
        expect(res.status).toBe(200);
        expect((await registros(venda.vendaId))[0]).toMatchObject({
            cancelado_por: A.u.gerente.id, autorizado_por: A.u.gerente.id, faixa_aplicada: 'acima_30_dias'
        });
    });
});

describe('a hierarquia é do comércio (cargos reordenados em C)', () => {
    test('Coordenador (45) fica abaixo do piso 55 do Supervisor; Supervisor e Analista (60) autorizam — sem mudar código', async () => {
        const venda = await criarVenda(C, 'vendedor', '10 days');

        // No comércio A (níveis padrão) o Coordenador (60) autorizaria; aqui, com 45, não.
        const coordenador = await cancelar(C, 'vendedor', venda.vendaId, { motivo: MOTIVO, autorizacao: credencial(C, 'coordenador') });
        expect(coordenador.status).toBe(403);
        await expectIntacta(venda);

        const analista = await cancelar(C, 'vendedor', venda.vendaId, { motivo: MOTIVO, autorizacao: credencial(C, 'analista') });
        expect(analista.status).toBe(200);
        expect((await registros(venda.vendaId))[0].autorizado_por).toBe(C.u.analista.id);

        const outra = await criarVenda(C, 'vendedor', '10 days');
        expect((await cancelar(C, 'vendedor', outra.vendaId, { motivo: MOTIVO, autorizacao: credencial(C, 'supervisor') })).status).toBe(200);
    });
});

describe('quem pode cancelar e quais vendas', () => {
    test('Estoquista não cancela (403); sem token é 401', async () => {
        const venda = await criarVenda(A, 'vendedor', '1 day');

        expect((await cancelar(A, 'estoquista', venda.vendaId)).status).toBe(403);
        expect((await request(app).patch(`/vendas/${venda.vendaId}/cancelar`).send({ motivo: MOTIVO })).status).toBe(401);
        await expectIntacta(venda);
    });

    test('Vendedor não cancela a venda de outro vendedor (404); Supervisor, que vê tudo, cancela', async () => {
        const venda = await criarVenda(A, 'vendedor', '1 day');

        expect((await cancelar(A, 'vendedor2', venda.vendaId)).status).toBe(404);
        await expectIntacta(venda);

        expect((await cancelar(A, 'supervisor', venda.vendaId)).status).toBe(200);
    });

    test('usuário de outro comércio nunca alcança a venda (404)', async () => {
        const venda = await criarVenda(A, 'vendedor', '1 day');

        expect((await cancelar(B, 'gerente', venda.vendaId)).status).toBe(404);
        expect((await request(app).get(`/vendas/${venda.vendaId}/cancelamento/previa`).set(auth(B, 'gerente'))).status).toBe(404);
        await expectIntacta(venda);
    });

    test('cancelar duas vezes: a segunda é 409 e existe um único registro', async () => {
        const venda = await criarVenda(A, 'vendedor', '1 day');

        expect((await cancelar(A, 'vendedor', venda.vendaId)).status).toBe(200);
        expect((await cancelar(A, 'vendedor', venda.vendaId)).status).toBe(409);

        expect(await registros(venda.vendaId)).toHaveLength(1);
        expect(await estoqueDe(venda.produtoId)).toBe(12);
    });

    test('duas requisições simultâneas: só uma cancela, o estoque volta uma vez só', async () => {
        const venda = await criarVenda(A, 'vendedor', '1 day');

        const respostas = await Promise.all([cancelar(A, 'vendedor', venda.vendaId), cancelar(A, 'vendedor', venda.vendaId)]);

        expect(respostas.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(await registros(venda.vendaId)).toHaveLength(1);
        expect(await estoqueDe(venda.produtoId)).toBe(12);
    });
});

describe('GET /vendas/:id/cancelamento/previa', () => {
    test('devolve a faixa e quem autoriza (cargo e nível do comércio), sem gravar nada', async () => {
        const venda = await criarVenda(A, 'vendedor', '45 days');

        const res = await request(app).get(`/vendas/${venda.vendaId}/cancelamento/previa`).set(auth(A, 'vendedor'));

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
            venda_id: venda.vendaId, status: 'finalizada', dias_da_venda: 45, faixa: 'acima_30_dias',
            exige_autorizacao: true, autorizador_minimo: { cargo: 'gerente', rotulo: 'Gerente', nivel: 70 }, pode_cancelar: true
        });
        await expectIntacta(venda);

        const livre = await criarVenda(A, 'vendedor', '2 days');
        const resLivre = await request(app).get(`/vendas/${livre.vendaId}/cancelamento/previa`).set(auth(A, 'vendedor'));
        expect(resLivre.body.data).toMatchObject({ faixa: 'ate_7_dias', exige_autorizacao: false, autorizador_minimo: null });
    });

    test('mostra o nível ajustado do comércio (C: a faixa 8–30 usa o Supervisor de lá = 55)', async () => {
        const venda = await criarVenda(C, 'vendedor', '10 days');

        const res = await request(app).get(`/vendas/${venda.vendaId}/cancelamento/previa`).set(auth(C, 'vendedor'));

        expect(res.body.data.autorizador_minimo).toEqual({ cargo: 'supervisor', rotulo: 'Supervisor', nivel: 55 });
    });
});

describe('GET /cancelamentos (histórico)', () => {
    let vendaAutorizada;

    beforeAll(async () => {
        vendaAutorizada = await criarVenda(A, 'vendedor', '12 days');
        expect((await cancelar(A, 'vendedor', vendaAutorizada.vendaId, { motivo: MOTIVO, autorizacao: credencial(A, 'supervisor') })).status).toBe(200);

        const deB = await criarVenda(B, 'vendedor', '1 day');
        expect((await cancelar(B, 'vendedor', deB.vendaId)).status).toBe(200);
    });

    const listar = (alvo, rotulo, query = '') => request(app).get(`/cancelamentos${query}`).set(auth(alvo, rotulo));

    test('exige a capacidade ver_cancelamentos: Vendedor e Analista 403, Supervisor 200, sem token 401', async () => {
        expect((await listar(A, 'vendedor')).status).toBe(403);
        expect((await listar(A, 'analista')).status).toBe(403);
        expect((await listar(A, 'supervisor')).status).toBe(200);
        expect((await request(app).get('/cancelamentos')).status).toBe(401);
    });

    test('traz todos os dados gravados, só da empresa do token', async () => {
        const res = await listar(A, 'supervisor', '?pageSize=100');

        expect(res.status).toBe(200);
        expect(res.body.data.items.length).toBeGreaterThan(5);
        expect(res.body.data.items.every((i) => Number(i.venda_id) > 0)).toBe(true);

        const item = res.body.data.items.find((i) => i.venda_id === vendaAutorizada.vendaId);
        expect(item).toMatchObject({
            motivo: MOTIVO, faixa_aplicada: '8_a_30_dias', dias_da_venda: 12, quantidade_devolvida: 2,
            cancelado_por: A.u.vendedor.id, cancelado_por_login: A.u.vendedor.email, cancelado_por_nome: `vendedor ${sufixo}`,
            autorizado_por: A.u.supervisor.id, autorizado_por_login: A.u.supervisor.email, autorizado_por_nome: `supervisor ${sufixo}`
        });
        expect(Number(item.valor_devolvido)).toBe(100);
        expect(Number(item.venda_total)).toBe(100);
        expect(item.cancelado_em).toEqual(expect.any(String));
        expect(JSON.stringify(res.body)).not.toMatch(/senha|custo/i);

        const deB = await listar(B, 'gerente', '?pageSize=100');
        expect(deB.body.data.items).toHaveLength(1);
        expect(deB.body.data.items.some((i) => i.venda_id === vendaAutorizada.vendaId)).toBe(false);
    });

    test('filtros: faixa, venda, quem cancelou, quem autorizou, período', async () => {
        const porFaixa = await listar(A, 'supervisor', '?faixa=8_a_30_dias&pageSize=100');
        expect(porFaixa.body.data.items.length).toBeGreaterThan(0);
        expect(porFaixa.body.data.items.every((i) => i.faixa_aplicada === '8_a_30_dias')).toBe(true);

        const porVenda = await listar(A, 'supervisor', `?venda_id=${vendaAutorizada.vendaId}`);
        expect(porVenda.body.data.total).toBe(1);

        const porAutorizador = await listar(A, 'supervisor', `?autorizado_por=${A.u.gerente.id}&pageSize=100`);
        expect(porAutorizador.body.data.items.every((i) => i.autorizado_por === A.u.gerente.id)).toBe(true);

        const porQuemCancelou = await listar(A, 'supervisor', `?cancelado_por=${A.u.vendedor2.id}`);
        expect(porQuemCancelou.body.data.total).toBe(0);

        // O filtro de período usa o calendário de São Paulo (o do usuário), não o UTC.
        const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        expect((await listar(A, 'supervisor', `?data_de=${hoje}&data_ate=${hoje}&pageSize=100`)).body.data.total).toBeGreaterThan(0);
        expect((await listar(A, 'supervisor', '?data_de=2000-01-01&data_ate=2000-01-02')).body.data.total).toBe(0);
    });

    test('paginação: mais recentes primeiro, total e páginas consistentes', async () => {
        const todos = (await listar(A, 'supervisor', '?pageSize=100')).body.data;
        const pagina1 = (await listar(A, 'supervisor', '?page=1&pageSize=2')).body.data;
        const pagina2 = (await listar(A, 'supervisor', '?page=2&pageSize=2')).body.data;

        expect(pagina1).toMatchObject({ page: 1, pageSize: 2, total: todos.total, totalPages: Math.ceil(todos.total / 2) });
        expect(pagina1.items.map((i) => i.id)).toEqual(todos.items.slice(0, 2).map((i) => i.id));
        expect(pagina2.items.map((i) => i.id)).toEqual(todos.items.slice(2, 4).map((i) => i.id));
        expect(todos.items.map((i) => i.cancelado_em)).toEqual([...todos.items.map((i) => i.cancelado_em)].sort().reverse());
    });

    test('filtros inválidos: 400', async () => {
        for (const query of ['?faixa=outra', '?data_de=ontem', '?pageSize=1000', '?venda_id=abc', '?data_de=2026-02-02&data_ate=2026-01-01']) {
            expect((await listar(A, 'supervisor', query)).status).toBe(400);
        }
    });
});
