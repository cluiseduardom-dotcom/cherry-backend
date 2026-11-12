// Integração de verdade (Postgres de testes): pedidos da loja para a EQUIPE e o aviso no sino.
// Prova: só admin e vendedor, só com a funcionalidade ligada, isolamento entre lojas, marcação idempotente, e o aviso
// aparecendo e sumindo. Empresas "Teste ..." temporárias, removidas no fim.
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = { nome: 'Gestao A' };
const B = { nome: 'Gestao B' };
const SEM_FLAG = { nome: 'Gestao Sem Flag' };

const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
let contador = 0;

async function criarEmpresa(E, { comFlag = true } = {}) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste ${E.nome} ${sufixo}`]));
    E.usuarios = {};
    for (const papel of ['admin', 'vendedor', 'estoquista']) {
        const id = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, 'x', $4) RETURNING id`, [E.id, papel, `${papel}-${E.id}-${sufixo}@teste.local`, papel]);
        E.usuarios[papel] = { id, token: makeToken({ id, role: papel, empresa_id: E.id, tv: 0 }) };
    }
    E.produto = await um(`INSERT INTO produtos (empresa_id, nome, custo, tipo, ativo, estoque_atual) VALUES ($1, 'Peça de teste', 5, 'acabado', true, 0) RETURNING id`, [E.id]);
    if (comFlag) {
        await db.query(`INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, 'loja_online', true, 'teste', 'teste')`, [E.id]);
    }
}

// Pedido direto no banco, no estado que o teste precisa.
async function pedido(E, { status = 'pago', nome = 'Maria de Teste', telefone = '11912345678', total = 100, pagoHa = '2 hours', combinada = false, cobranca = null } = {}) {
    const codigo = crypto.randomUUID();
    const chave = `chave-${sufixo}-${++contador}-${crypto.randomBytes(3).toString('hex')}`;
    const encerrado = ['expirado', 'cancelado'].includes(status);
    const id = await um(
        `INSERT INTO pedidos_loja (codigo, empresa_id, status, cliente_nome, cliente_email, cliente_telefone, chave_idempotencia, hash_requisicao,
                subtotal, total, reserva_expira_em, pago_em, encerrado_em, motivo_encerramento, entrega_combinada_em, entrega_combinada_por, cobranca_codigo)
         VALUES ($1, $2, $3::text, $4, $5, $6, $7, $8, $9, $9, NOW() + INTERVAL '30 minutes',
                 CASE WHEN $3::text = 'pago' THEN NOW() - $10::interval END,
                 CASE WHEN $11 THEN NOW() END, CASE WHEN $11 THEN 'teste' END,
                 CASE WHEN $12 THEN NOW() END, CASE WHEN $12 THEN $13::int END, $14)
         RETURNING id`,
        [codigo, E.id, status, nome, 'cliente@teste.local', telefone, chave, 'a'.repeat(64), total, pagoHa, encerrado, combinada, E.usuarios.admin.id, cobranca]
    );
    await db.query(`INSERT INTO itens_pedido_loja (pedido_id, produto_id, empresa_id, nome, quantidade, preco_unitario) VALUES ($1, $2, $3, 'Brinco de teste', 2, $4)`, [id, E.produto, E.id, total / 2]);

    return { id, codigo };
}

async function cobrancaPaga(E, { minutosAtras = 30, status = 'pago' } = {}) {
    const codigo = crypto.randomUUID();
    await db.query(
        `INSERT INTO cobrancas_pagamento (codigo, empresa_id, metodo, valor, taxa_plataforma, status, id_externo, criado_por) VALUES ($1, $2, 'pix', 99, 0, $3, $4, NULL)`,
        [codigo, E.id, status, String(Math.floor(Math.random() * 1e9))]
    );
    await db.query(`UPDATE cobrancas_pagamento SET atualizado_em = NOW() - ($2::int * INTERVAL '1 minute') WHERE codigo = $1`, [codigo, minutosAtras]);

    return codigo;
}

const get = (E, papel, caminho) => request(app).get(caminho).set('Authorization', `Bearer ${E.usuarios[papel].token}`);
const post = (E, papel, caminho, corpo = {}) => request(app).post(caminho).set('Authorization', `Bearer ${E.usuarios[papel].token}`).send(corpo);
const avisosDaLoja = async (E, papel) => (await get(E, papel, '/notificacoes')).body.data.itens.filter((i) => i.tipo.startsWith('loja_'));

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

describe('quem pode ver e mexer', () => {
    test('sem token: 401; estoquista: 403; admin e vendedor: 200', async () => {
        expect((await request(app).get('/loja-pedidos')).status).toBe(401);
        expect((await get(A, 'estoquista', '/loja-pedidos')).status).toBe(403);
        expect((await get(A, 'admin', '/loja-pedidos')).status).toBe(200);
        expect((await get(A, 'vendedor', '/loja-pedidos')).status).toBe(200);
    });

    test('empresa sem a funcionalidade loja_online: 403 de plano, mesmo para o admin', async () => {
        const res = await get(SEM_FLAG, 'admin', '/loja-pedidos');

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/plano/i);
    });

    test('estoquista e visitante não conseguem marcar entrega', async () => {
        const p = await pedido(A);

        expect((await post(A, 'estoquista', `/loja-pedidos/${p.codigo}/entrega-combinada`)).status).toBe(403);
        expect((await request(app).post(`/loja-pedidos/${p.codigo}/entrega-combinada`).send({})).status).toBe(401);
    });

    test('a resposta com dado pessoal nunca vai para cache', async () => {
        expect((await get(A, 'admin', '/loja-pedidos')).headers['cache-control']).toBe('no-store');
    });
});

describe('lista de pedidos', () => {
    test('a combinar: só pagos sem entrega combinada, do mais antigo para o mais novo, com contato e itens', async () => {
        const antigo = await pedido(A, { nome: 'Antiga', pagoHa: '30 hours', total: 50 });
        const novo = await pedido(A, { nome: 'Nova', pagoHa: '1 hour', total: 70 });
        await pedido(A, { nome: 'JaCombinada', combinada: true });
        await pedido(A, { nome: 'Aguardando', status: 'aguardando_pagamento' });
        await pedido(A, { nome: 'Expirada', status: 'expirado' });

        const res = await get(A, 'vendedor', '/loja-pedidos');
        const nomes = res.body.data.itens.map((i) => i.cliente.nome);

        expect(nomes.indexOf('Antiga')).toBeLessThan(nomes.indexOf('Nova'));
        expect(nomes).not.toEqual(expect.arrayContaining(['JaCombinada', 'Aguardando', 'Expirada']));
        const primeiro = res.body.data.itens.find((i) => i.codigo === antigo.codigo);
        expect(primeiro).toMatchObject({ codigo_curto: antigo.codigo.slice(0, 8).toUpperCase(), status: 'pago', total: 50, cliente: { nome: 'Antiga', telefone: '11912345678', email: 'cliente@teste.local' } });
        expect(primeiro.itens).toEqual([{ nome: 'Brinco de teste', quantidade: 2 }]);
        expect(novo.codigo).toBeTruthy();
    });

    test('situações combinadas e todos; paginação traz o total', async () => {
        const combinadas = await get(A, 'admin', '/loja-pedidos?situacao=combinadas');
        const todos = await get(A, 'admin', '/loja-pedidos?situacao=todos&limite=2&pagina=1');

        expect(combinadas.body.data.itens.every((i) => i.entrega_combinada_em !== null && i.status === 'pago')).toBe(true);
        expect(todos.body.data.itens).toHaveLength(2);
        expect(todos.body.data.total).toBeGreaterThan(2);
        expect(todos.body.data).toMatchObject({ pagina: 1, limite: 2 });
    });

    test('ISOLAMENTO: a loja B nunca vê pedido (nem contato) da loja A, e vice-versa', async () => {
        const deB = await pedido(B, { nome: 'ClienteDaLojaB', telefone: '11999990000' });
        const listaA = JSON.stringify((await get(A, 'admin', '/loja-pedidos?situacao=todos&limite=50')).body);
        const listaB = JSON.stringify((await get(B, 'admin', '/loja-pedidos?situacao=todos&limite=50')).body);

        expect(listaA).not.toContain('ClienteDaLojaB');
        expect(listaB).toContain('ClienteDaLojaB');
        expect(listaB).not.toContain('Antiga');
        expect(deB.codigo).toBeTruthy();
    });

    test.each([['situacao=inventada'], ['limite=0'], ['limite=51'], ['pagina=0'], ['pagina=abc']])('consulta inválida (%s): 400', async (qs) => {
        expect((await get(A, 'admin', `/loja-pedidos?${qs}`)).status).toBe(400);
    });

    test('a lista não traz custo, taxa, id interno, chave de idempotência nem dado do provedor', async () => {
        const texto = JSON.stringify((await get(A, 'admin', '/loja-pedidos?situacao=todos')).body);

        expect(texto).not.toMatch(/custo|margem|taxa|chave_idempotencia|hash_requisicao|cobranca_codigo|id_externo|empresa_id|"id"/i);
    });
});

describe('marcar entrega combinada', () => {
    test('registra quando, quem e a observação; o pedido sai da fila "a combinar"', async () => {
        const p = await pedido(A, { nome: 'ParaMarcar' });

        const res = await post(A, 'vendedor', `/loja-pedidos/${p.codigo}/entrega-combinada`, { observacao: '  Retira na loja sexta  ' });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ codigo: p.codigo, entrega_observacao: 'Retira na loja sexta' });
        expect(res.body.data.entrega_combinada_em).not.toBeNull();

        const { rows: [linha] } = await db.query('SELECT entrega_combinada_por FROM pedidos_loja WHERE id = $1', [p.id]);
        expect(linha.entrega_combinada_por).toBe(A.usuarios.vendedor.id);
        expect((await db.query(`SELECT tipo FROM pedidos_loja_eventos WHERE pedido_id = $1`, [p.id])).rows.map((r) => r.tipo)).toEqual(['entrega_combinada']);

        const fila = (await get(A, 'admin', '/loja-pedidos?limite=50')).body.data.itens.map((i) => i.codigo);
        expect(fila).not.toContain(p.codigo);
    });

    test('é idempotente: marcar de novo devolve o mesmo registro e não duplica o evento nem troca quem marcou', async () => {
        const p = await pedido(A);
        const primeira = await post(A, 'vendedor', `/loja-pedidos/${p.codigo}/entrega-combinada`, { observacao: 'primeira' });
        const segunda = await post(A, 'admin', `/loja-pedidos/${p.codigo}/entrega-combinada`, { observacao: 'segunda' });

        expect(segunda.status).toBe(200);
        expect(segunda.body.data.entrega_combinada_em).toBe(primeira.body.data.entrega_combinada_em);
        expect(segunda.body.data.entrega_observacao).toBe('primeira');
        expect((await db.query(`SELECT COUNT(*)::int AS n FROM pedidos_loja_eventos WHERE pedido_id = $1`, [p.id])).rows[0].n).toBe(1);
        expect((await db.query('SELECT entrega_combinada_por FROM pedidos_loja WHERE id = $1', [p.id])).rows[0].entrega_combinada_por).toBe(A.usuarios.vendedor.id);
    });

    test('duas marcações simultâneas: uma só vale', async () => {
        const p = await pedido(A);
        const res = await Promise.all([post(A, 'admin', `/loja-pedidos/${p.codigo}/entrega-combinada`), post(A, 'vendedor', `/loja-pedidos/${p.codigo}/entrega-combinada`)]);

        expect(res.map((r) => r.status)).toEqual([200, 200]);
        expect((await db.query(`SELECT COUNT(*)::int AS n FROM pedidos_loja_eventos WHERE pedido_id = $1`, [p.id])).rows[0].n).toBe(1);
    });

    test.each([['aguardando_pagamento'], ['expirado'], ['cancelado']])('pedido %s não pode ter entrega combinada (409)', async (status) => {
        const p = await pedido(A, { status });

        expect((await post(A, 'admin', `/loja-pedidos/${p.codigo}/entrega-combinada`)).status).toBe(409);
    });

    test('pedido de outra loja, inexistente ou código malformado: 404 (nada é alterado)', async () => {
        const deB = await pedido(B);

        expect((await post(A, 'admin', `/loja-pedidos/${deB.codigo}/entrega-combinada`)).status).toBe(404);
        expect((await post(A, 'admin', `/loja-pedidos/${crypto.randomUUID()}/entrega-combinada`)).status).toBe(404);
        expect((await post(A, 'admin', '/loja-pedidos/nao-e-uuid/entrega-combinada')).status).toBe(404);
        expect((await db.query('SELECT entrega_combinada_em FROM pedidos_loja WHERE id = $1', [deB.id])).rows[0].entrega_combinada_em).toBeNull();
    });

    test('corpo estrito: campo extra e observação longa são 400', async () => {
        const p = await pedido(A);

        expect((await post(A, 'admin', `/loja-pedidos/${p.codigo}/entrega-combinada`, { observacao: 'x'.repeat(501) })).status).toBe(400);
        expect((await post(A, 'admin', `/loja-pedidos/${p.codigo}/entrega-combinada`, { empresa_id: B.id })).status).toBe(400);
        expect((await db.query('SELECT entrega_combinada_em FROM pedidos_loja WHERE id = $1', [p.id])).rows[0].entrega_combinada_em).toBeNull();
    });

    test('o banco recusa entrega combinada em pedido que não está pago', async () => {
        const p = await pedido(A, { status: 'aguardando_pagamento' });

        await expect(db.query('UPDATE pedidos_loja SET entrega_combinada_em = NOW() WHERE id = $1', [p.id])).rejects.toThrow(/pedidos_loja_entrega_chk/);
    });
});

describe('aviso no sino', () => {
    test('pedido pago aparece para admin e vendedor, com nome e telefone, e some quando a entrega é combinada', async () => {
        const p = await pedido(A, { nome: 'AvisoDoSino', telefone: '11955554444', total: 88 });

        for (const papel of ['admin', 'vendedor']) {
            const aviso = (await avisosDaLoja(A, papel)).find((a) => a.id === `loja_pedido_pago:${p.id}`);

            expect(aviso).toBeDefined();
            expect(aviso).toMatchObject({ tipo: 'loja_pedido_pago', item: 'pedido', pedido_codigo: p.codigo });
            expect(aviso.mensagem).toContain('AvisoDoSino');
            expect(aviso.mensagem).toContain('11955554444');
            expect(aviso.mensagem).toContain('R$ 88,00');
        }

        await post(A, 'vendedor', `/loja-pedidos/${p.codigo}/entrega-combinada`);

        expect((await avisosDaLoja(A, 'admin')).find((a) => a.id === `loja_pedido_pago:${p.id}`)).toBeUndefined();
    });

    test('estoquista nunca recebe o aviso (ele traz o contato da cliente)', async () => {
        await pedido(A, { nome: 'NaoParaEstoquista' });

        expect(JSON.stringify((await get(A, 'estoquista', '/notificacoes')).body)).not.toContain('NaoParaEstoquista');
    });

    test('ISOLAMENTO: o aviso de uma loja nunca aparece no sino de outra', async () => {
        await pedido(B, { nome: 'SoDaLojaB' });

        expect(JSON.stringify((await get(A, 'admin', '/notificacoes')).body)).not.toContain('SoDaLojaB');
        expect(JSON.stringify((await get(B, 'admin', '/notificacoes')).body)).toContain('SoDaLojaB');
    });

    test('empresa sem a funcionalidade nem consulta: nenhum aviso da loja', async () => {
        await pedido(SEM_FLAG, { nome: 'SemFlagAviso' });

        expect(JSON.stringify((await get(SEM_FLAG, 'admin', '/notificacoes')).body)).not.toContain('SemFlagAviso');
    });

    test('pagamento recebido que não virou venda há mais de 5 minutos: aviso alto de devolução', async () => {
        const cobranca = await cobrancaPaga(A, { minutosAtras: 30 });
        const p = await pedido(A, { status: 'expirado', nome: 'PagouSemEstoque', cobranca });

        const aviso = (await avisosDaLoja(A, 'admin')).find((a) => a.id === `loja_pagamento_sem_venda:${p.id}`);

        expect(aviso).toMatchObject({ tipo: 'loja_pagamento_sem_venda', prioridade: 'alta' });
        expect(aviso.mensagem).toMatch(/depois de a reserva expirar/);
        expect(aviso.acao).toMatch(/devolver/i);
    });

    test('pagamento recente (menos de 5 min), já estornado ou já com venda não geram esse aviso', async () => {
        const recente = await pedido(A, { status: 'expirado', cobranca: await cobrancaPaga(A, { minutosAtras: 1 }) });
        const estornado = await pedido(A, { status: 'expirado', cobranca: await cobrancaPaga(A, { minutosAtras: 30, status: 'estornado' }) });
        const ids = (await avisosDaLoja(A, 'admin')).map((a) => a.id);

        expect(ids).not.toContain(`loja_pagamento_sem_venda:${recente.id}`);
        expect(ids).not.toContain(`loja_pagamento_sem_venda:${estornado.id}`);
    });

    test('pagamento estornado com a venda finalizada gera aviso alto; venda cancelada ou cobrança paga não geram', async () => {
        const canal = await um(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'canal-estorno-teste', true) RETURNING id`, [A.id]);
        const vendaCom = async (E, status) => um(`INSERT INTO vendas (empresa_id, canal_id, status) VALUES ($1, $2, $3) RETURNING id`, [E.id, canal, status]);
        const cobrancaComVenda = async (E, statusCobranca, statusVenda) => {
            const codigo = await cobrancaPaga(E, { status: statusCobranca });
            await db.query(`UPDATE cobrancas_pagamento SET venda_id = $2, usada_em = NOW() WHERE codigo = $1`, [codigo, await vendaCom(E, statusVenda)]);
            return codigo;
        };
        const ativa = await pedido(A, { status: 'pago', nome: 'EstornoAtivo', cobranca: await cobrancaComVenda(A, 'estornado', 'finalizada') });
        const cancelada = await pedido(A, { status: 'pago', cobranca: await cobrancaComVenda(A, 'estornado', 'cancelada') });
        const normal = await pedido(A, { status: 'pago', cobranca: await cobrancaComVenda(A, 'pago', 'finalizada') });
        const avisos = await avisosDaLoja(A, 'admin');
        const aviso = avisos.find((a) => a.id === `loja_pagamento_estornado:${ativa.id}`);

        expect(aviso).toMatchObject({ tipo: 'loja_pagamento_estornado', prioridade: 'alta' });
        expect(avisos.map((a) => a.id)).not.toContain(`loja_pagamento_estornado:${cancelada.id}`);
        expect(avisos.map((a) => a.id)).not.toContain(`loja_pagamento_estornado:${normal.id}`);
        expect(JSON.stringify((await get(B, 'admin', '/notificacoes')).body)).not.toContain('EstornoAtivo');
        expect((await avisosDaLoja(A, 'estoquista'))).toEqual([]);
    });

    test('o aviso não traz custo, margem, taxa, e-mail nem dado do provedor', async () => {
        const texto = JSON.stringify(await avisosDaLoja(A, 'admin'));

        expect(texto).not.toMatch(/custo|margem|taxa|id_externo|cliente@teste\.local/i);
    });
});
