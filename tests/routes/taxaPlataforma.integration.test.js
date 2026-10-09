// Integração de verdade (Postgres real da CI/dev, sem mock de db/sessão): prova,
// fim a fim (rota -> controller -> service -> repository -> Postgres), a taxa
// interna da plataforma (VERTUMNO/GiroOne) — uma por venda, na mesma transação,
// isolada por empresa, invisível na API de vendas e protegida por RBAC.
//
// Cria DUAS empresas temporárias próprias (com admin/vendedor/estoquista, canal,
// produtos e preços) e remove tudo no afterAll; não depende do seed nem toca em
// dados dele. A política global da plataforma (migration 046) é só LIDA; os
// testes que "mexem" nela o fazem em transação própria NÃO confirmada (ROLLBACK),
// então nenhum outro teste/conexão enxerga a mudança.

jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const taxasPlataformaRepository = require('../../src/repositories/taxasPlataformaRepository');

const SUFIXO = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(12).toString('hex');

const empresas = {}; // { A: { id, canalId, produtos:{ caro, barato }, tokens:{ admin, vendedor, estoquista } }, B: {...} }
const vendasCriadas = { A: [], B: [] };

async function criarUsuario(empresaId, papel, rotulo) {
    const email = `taxa-${rotulo}-${papel}-${SUFIXO}@teste.invalid`;
    await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, $5)`,
        [empresaId, `Teste ${papel} ${rotulo}`, email, await bcrypt.hash(SENHA, 4), papel]
    );
    const res = await request(app).post('/auth/login').send({ email, senha: SENHA });
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.token;
}

async function criarProduto(token, canalId, nome, preco) {
    const prod = await request(app)
        .post('/produtos')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome, preco_venda: preco, custo: 0.5, estoque_atual: 50, estoque_minimo: 1 });
    if (prod.status !== 201) throw new Error(`produto ${nome}: ${prod.status} ${JSON.stringify(prod.body)}`);

    const id = prod.body.data.id;
    const precoRes = await request(app)
        .put(`/produtos/${id}/precos/${canalId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preco_venda: preco });
    if (precoRes.status !== 201) throw new Error(`preço ${nome}: ${precoRes.status} ${JSON.stringify(precoRes.body)}`);

    return id;
}

async function montarEmpresa(rotulo, precoCaro) {
    const emp = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Taxa Plataforma ${rotulo} ${SUFIXO}`]);
    const id = emp.rows[0].id;
    const canal = await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [id]);
    const canalId = canal.rows[0].id;

    const tokens = { admin: await criarUsuario(id, 'admin', rotulo) };
    const caro = await criarProduto(tokens.admin, canalId, `Caro ${rotulo}`, precoCaro);
    const barato = await criarProduto(tokens.admin, canalId, `Barato ${rotulo}`, 1);

    if (rotulo === 'A') {
        tokens.vendedor = await criarUsuario(id, 'vendedor', rotulo);
        tokens.estoquista = await criarUsuario(id, 'estoquista', rotulo);
    }

    empresas[rotulo] = { id, canalId, produtos: { caro, barato }, tokens };
}

const venda = (rotulo, corpo, cabecalhos = {}) => {
    const req = request(app).post('/vendas').set('Authorization', `Bearer ${empresas[rotulo].tokens.admin}`);
    Object.entries(cabecalhos).forEach(([k, v]) => req.set(k, v));
    return req.send(corpo);
};

async function taxasDaVenda(vendaId) {
    const { rows } = await db.query('SELECT * FROM taxas_venda WHERE venda_id = $1', [vendaId]);
    return rows;
}

async function estoqueDe(produtoId) {
    const { rows } = await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [produtoId]);
    return rows[0].estoque_atual;
}

beforeAll(async () => {
    await montarEmpresa('A', 120);
    await montarEmpresa('B', 50);
});

afterAll(async () => {
    for (const { id } of Object.values(empresas)) {
        await db.query('DELETE FROM taxas_venda WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM estornos_pagamento WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM parcelas_pagamento WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM pagamentos_venda WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM idempotency_keys WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM itens_venda WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM movimentacoes_estoque WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM vendas WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM precos_produto WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM produtos WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM canais_venda WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM usuarios WHERE empresa_id = $1', [id]);
        await db.query('DELETE FROM empresas WHERE id = $1', [id]);
    }

    await db.end();
});

afterEach(() => jest.restoreAllMocks());

describe('política global da plataforma (migration 046)', () => {
    test('existe a política inicial: 0,15% percentual, sem fim, ativa, sem empresa_id', async () => {
        const { rows } = await db.query(
            `SELECT tipo, percentual::text, vigencia_inicio::text, vigencia_fim, ativo FROM politicas_taxa_plataforma ORDER BY id`
        );
        const inicial = rows[0];

        expect(inicial).toMatchObject({ tipo: 'percentual', percentual: '0.1500', vigencia_inicio: '2026-10-09', vigencia_fim: null, ativo: true });

        const colunas = await db.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'politicas_taxa_plataforma'`
        );
        expect(colunas.rows.map((c) => c.column_name)).not.toContain('empresa_id');
    });

    test('não aceita duas políticas ATIVAS com vigência sobreposta (EXCLUDE), mas aceita histórico inativo', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await expect(
                client.query(`INSERT INTO politicas_taxa_plataforma (percentual, vigencia_inicio, ativo) VALUES (1, DATE '2027-01-01', true)`)
            ).rejects.toMatchObject({ code: '23P01' });
            await client.query('ROLLBACK');

            await client.query('BEGIN');
            await client.query(`INSERT INTO politicas_taxa_plataforma (percentual, vigencia_inicio, ativo) VALUES (1, DATE '2027-01-01', false)`);
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });

    test('rejeita percentual fora de 0..100 e vigência invertida', async () => {
        const client = await db.connect();
        try {
            for (const sql of [
                `INSERT INTO politicas_taxa_plataforma (percentual, vigencia_inicio, ativo) VALUES (100.0001, DATE '2030-01-01', false)`,
                `INSERT INTO politicas_taxa_plataforma (percentual, vigencia_inicio, ativo) VALUES (-1, DATE '2030-01-01', false)`,
                `INSERT INTO politicas_taxa_plataforma (percentual, vigencia_inicio, vigencia_fim, ativo) VALUES (1, DATE '2030-02-01', DATE '2030-01-01', false)`
            ]) {
                await client.query('BEGIN');
                await expect(client.query(sql)).rejects.toMatchObject({ code: '23514' });
                await client.query('ROLLBACK');
            }
        } finally {
            client.release();
        }
    });

    test('sem política vigente (ativo=false, em transação não confirmada) a busca devolve null e apurar bloqueia', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE politicas_taxa_plataforma SET ativo = false');

            expect(await taxasPlataformaRepository.buscarPoliticaVigente(client)).toBeNull();
            await expect(
                taxasPlataformaRepository.apurar({ venda_id: 1, empresa_id: 1, total: 100 }, client)
            ).rejects.toMatchObject({ statusCode: 500 });

            await client.query('ROLLBACK');
        } finally {
            client.release();
        }

        const ativa = await db.query('SELECT count(*)::int AS n FROM politicas_taxa_plataforma WHERE ativo = true');
        expect(ativa.rows[0].n).toBeGreaterThanOrEqual(1);
    });

    test('política com vigência encerrada ou futura não é aplicada', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query(`UPDATE politicas_taxa_plataforma SET vigencia_inicio = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date + 1`);
            expect(await taxasPlataformaRepository.buscarPoliticaVigente(client)).toBeNull(); // ainda não começou

            await client.query(
                `UPDATE politicas_taxa_plataforma SET vigencia_inicio = DATE '2026-01-01', vigencia_fim = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 1`
            );
            expect(await taxasPlataformaRepository.buscarPoliticaVigente(client)).toBeNull(); // já terminou
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });
});

describe('venda com pagamentos mistos: UMA taxa de 0,15% sobre vendas.total', () => {
    let vendaMistaId;

    test('R$ 120,00 com PIX 30 + Crédito 3x 90: 201 e exatamente uma linha em taxas_venda (R$ 0,18)', async () => {
        const res = await venda('A', {
            itens: [{ produto_id: empresas.A.produtos.caro, quantidade: 1 }],
            pagamentos: [
                { forma_pagamento: 'pix', valor: 30 },
                { forma_pagamento: 'credito', valor: 90, numero_parcelas: 3 }
            ]
        });

        expect(res.status).toBe(201);
        vendaMistaId = res.body.data.id;
        vendasCriadas.A.push(vendaMistaId);

        const pagamentos = await db.query('SELECT count(*)::int AS n FROM pagamentos_venda WHERE venda_id = $1', [vendaMistaId]);
        expect(pagamentos.rows[0].n).toBe(2);

        const taxas = await taxasDaVenda(vendaMistaId);
        expect(taxas).toHaveLength(1); // uma por venda, não uma por pagamento
        expect(taxas[0]).toMatchObject({
            empresa_id: empresas.A.id,
            tipo: 'percentual',
            percentual: '0.1500',
            base_calculo: '120.00',
            valor: '0.18',
            status: 'apurada'
        });
        expect(taxas[0].estornado_em).toBeNull();
    });

    test('desconto e acréscimo já estão no total: R$ 120 - 10 + 5 = R$ 115 (base) gera R$ 0,17', async () => {
        const res = await venda('A', {
            itens: [{ produto_id: empresas.A.produtos.caro, quantidade: 1 }],
            desconto: 10,
            juros: 5
        });

        expect(res.status).toBe(201);
        vendasCriadas.A.push(res.body.data.id);

        const [taxa] = await taxasDaVenda(res.body.data.id);
        expect(taxa).toMatchObject({ base_calculo: '115.00', valor: '0.17' }); // 11500 * 0,0015 = 17,25 -> 17 centavos
        expect(res.body.data.total).toBe(115);
    });

    test('R$ 1,00 gera taxa R$ 0,00 (R$ 0,0015 arredondado), sem mínimo artificial, e a venda conclui', async () => {
        const res = await venda('A', { itens: [{ produto_id: empresas.A.produtos.barato, quantidade: 1 }] });

        expect(res.status).toBe(201);
        vendasCriadas.A.push(res.body.data.id);

        const [taxa] = await taxasDaVenda(res.body.data.id);
        expect(taxa).toMatchObject({ base_calculo: '1.00', valor: '0.00', status: 'apurada' });
    });

    test('UNIQUE(venda_id): uma segunda taxa para a mesma venda é rejeitada pelo banco', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await expect(
                client.query(
                    `INSERT INTO taxas_venda (venda_id, empresa_id, politica_id, tipo, percentual, base_calculo, valor)
                     SELECT venda_id, empresa_id, politica_id, tipo, percentual, base_calculo, valor FROM taxas_venda WHERE venda_id = $1`,
                    [vendaMistaId]
                )
            ).rejects.toMatchObject({ code: '23505' });
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });

    test('replay idempotente (mesma Idempotency-Key) devolve a mesma venda e NÃO gera segunda taxa', async () => {
        // Formato atual do PDV (pagamentos[]): é o que persiste a resposta da chave.
        const corpo = {
            itens: [{ produto_id: empresas.A.produtos.caro, quantidade: 1 }],
            pagamentos: [{ forma_pagamento: 'pix', valor: 120 }]
        };
        const chave = { 'Idempotency-Key': `taxa-${SUFIXO}` };

        const primeira = await venda('A', corpo, chave);
        expect(primeira.status).toBe(201);
        vendasCriadas.A.push(primeira.body.data.id);

        const segunda = await venda('A', corpo, chave);
        expect(segunda.status).toBe(201);
        expect(segunda.body.data.id).toBe(primeira.body.data.id);

        expect(await taxasDaVenda(primeira.body.data.id)).toHaveLength(1);
    });

    test('política nova não altera a taxa já gravada: o percentual fica congelado na linha', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE politicas_taxa_plataforma SET percentual = 5.0000');

            const { rows } = await client.query('SELECT percentual::text, base_calculo::text, valor::text FROM taxas_venda WHERE venda_id = $1', [vendaMistaId]);
            expect(rows[0]).toEqual({ percentual: '0.1500', base_calculo: '120.00', valor: '0.18' });

            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });
});

describe('a taxa interna não aparece na API de vendas (PDV, operador, cliente)', () => {
    test('POST/GET de vendas não expõem a taxa nem o nome da plataforma, para admin e vendedor', async () => {
        const criada = await venda('A', { itens: [{ produto_id: empresas.A.produtos.caro, quantidade: 1 }] });
        expect(criada.status).toBe(201);
        vendasCriadas.A.push(criada.body.data.id);

        const authAdmin = { Authorization: `Bearer ${empresas.A.tokens.admin}` };
        const authVendedor = { Authorization: `Bearer ${empresas.A.tokens.vendedor}` };

        // O vendedor só enxerga as próprias vendas: cria uma e lê lista e detalhe.
        const doVendedor = await request(app)
            .post('/vendas')
            .set(authVendedor)
            .send({ itens: [{ produto_id: empresas.A.produtos.caro, quantidade: 1 }] });
        expect(doVendedor.status).toBe(201);
        vendasCriadas.A.push(doVendedor.body.data.id);

        const respostas = [
            criada,
            doVendedor,
            await request(app).get('/vendas').set(authAdmin),
            await request(app).get(`/vendas/${criada.body.data.id}`).set(authAdmin),
            await request(app).get('/vendas').set(authVendedor),
            await request(app).get(`/vendas/${doVendedor.body.data.id}`).set(authVendedor)
        ];

        for (const res of respostas) {
            expect(res.status).toBeLessThan(300);
            expect(JSON.stringify(res.body)).not.toMatch(/taxa|vertumno|giroone|plataforma/i);
        }
    });
});

describe('RBAC e isolamento multi-tenant da consulta administrativa', () => {
    const listar = (token, query = '') =>
        request(app).get(`/financeiro/taxas-venda${query}`).set('Authorization', `Bearer ${token}`);

    test('vendedor e estoquista recebem 403; sem token 401', async () => {
        expect((await listar(empresas.A.tokens.vendedor)).status).toBe(403);
        expect((await listar(empresas.A.tokens.estoquista)).status).toBe(403);
        expect((await request(app).get('/financeiro/taxas-venda')).status).toBe(401);
    });

    test('admin da empresa A vê só as taxas da própria empresa, com totais das apuradas', async () => {
        const res = await listar(empresas.A.tokens.admin, '?pageSize=100');

        expect(res.status).toBe(200);
        const ids = res.body.data.items.map((i) => i.venda_id);
        expect(ids.sort()).toEqual([...vendasCriadas.A].sort());
        expect(res.body.data.items.every((i) => i.status === 'apurada')).toBe(true);

        const somaCentavos = res.body.data.items.reduce((s, i) => s + Math.round(Number(i.valor) * 100), 0);
        expect(Math.round(Number(res.body.data.totais.total_taxa) * 100)).toBe(somaCentavos);
    });

    test('empresa B tem a própria taxa isolada e não enxerga nem a de A; empresa_id na query é ignorado', async () => {
        const vendaB = await venda('B', { itens: [{ produto_id: empresas.B.produtos.caro, quantidade: 1 }] });
        expect(vendaB.status).toBe(201);
        vendasCriadas.B.push(vendaB.body.data.id);

        const [taxaB] = await taxasDaVenda(vendaB.body.data.id);
        expect(taxaB).toMatchObject({ empresa_id: empresas.B.id, base_calculo: '50.00', valor: '0.08' }); // 5000 * 0,0015 = 7,5 -> 8

        const res = await listar(empresas.B.tokens.admin, `?pageSize=100&empresa_id=${empresas.A.id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.items.map((i) => i.venda_id)).toEqual([vendaB.body.data.id]);
        expect(res.body.data.items.map((i) => i.venda_id)).not.toEqual(expect.arrayContaining(vendasCriadas.A));

        const deA = await listar(empresas.A.tokens.admin, '?pageSize=100');
        expect(deA.body.data.items.map((i) => i.venda_id)).not.toContain(vendaB.body.data.id);
    });

    test('filtro de período usa a data da venda', async () => {
        const futuro = await listar(empresas.A.tokens.admin, '?data_inicio=2999-01-01&data_fim=2999-12-31');
        expect(futuro.status).toBe(200);
        expect(futuro.body.data.items).toHaveLength(0);
        expect(futuro.body.data.totais).toEqual({ total_base: '0', total_taxa: '0' });
    });
});

describe('falha na taxa impede a conclusão da venda (rollback real no banco)', () => {
    test('falha simulada ao apurar: 500 genérico, sem venda, sem pagamento e sem baixa de estoque', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(taxasPlataformaRepository, 'apurar').mockRejectedValueOnce(new Error('falha simulada na taxa'));

        const estoqueAntes = await estoqueDe(empresas.A.produtos.caro);
        const vendasAntes = (await db.query('SELECT count(*)::int AS n FROM vendas WHERE empresa_id = $1', [empresas.A.id])).rows[0].n;
        const pagAntes = (await db.query('SELECT count(*)::int AS n FROM pagamentos_venda WHERE empresa_id = $1', [empresas.A.id])).rows[0].n;
        const taxasAntes = (await db.query('SELECT count(*)::int AS n FROM taxas_venda WHERE empresa_id = $1', [empresas.A.id])).rows[0].n;

        const res = await venda('A', {
            itens: [{ produto_id: empresas.A.produtos.caro, quantidade: 2 }],
            pagamentos: [{ forma_pagamento: 'pix', valor: 240 }]
        });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ success: false, message: 'Erro interno do servidor' });
        expect(JSON.stringify(res.body)).not.toMatch(/taxa|vertumno|plataforma/i);

        expect(await estoqueDe(empresas.A.produtos.caro)).toBe(estoqueAntes); // baixa de estoque desfeita
        expect((await db.query('SELECT count(*)::int AS n FROM vendas WHERE empresa_id = $1', [empresas.A.id])).rows[0].n).toBe(vendasAntes);
        expect((await db.query('SELECT count(*)::int AS n FROM pagamentos_venda WHERE empresa_id = $1', [empresas.A.id])).rows[0].n).toBe(pagAntes);
        expect((await db.query('SELECT count(*)::int AS n FROM taxas_venda WHERE empresa_id = $1', [empresas.A.id])).rows[0].n).toBe(taxasAntes);
    });

    test('depois da falha a mesma venda funciona normalmente (nada ficou preso)', async () => {
        const res = await venda('A', { itens: [{ produto_id: empresas.A.produtos.caro, quantidade: 1 }] });

        expect(res.status).toBe(201);
        vendasCriadas.A.push(res.body.data.id);
        expect(await taxasDaVenda(res.body.data.id)).toHaveLength(1);
    });

    test('falha com Idempotency-Key não deixa a chave "em processamento": o retry conclui', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(taxasPlataformaRepository, 'apurar').mockRejectedValueOnce(new Error('falha simulada na taxa'));

        const corpo = {
            itens: [{ produto_id: empresas.A.produtos.caro, quantidade: 1 }],
            pagamentos: [{ forma_pagamento: 'pix', valor: 120 }]
        };
        const chave = { 'Idempotency-Key': `taxa-falha-${SUFIXO}` };

        const falha = await venda('A', corpo, chave);
        expect(falha.status).toBe(500);

        const retry = await venda('A', corpo, chave);
        expect(retry.status).toBe(201);
        vendasCriadas.A.push(retry.body.data.id);
        expect(await taxasDaVenda(retry.body.data.id)).toHaveLength(1);
    });
});

describe('cancelamento estorna a taxa e preserva o histórico', () => {
    test('PATCH /vendas/:id/cancelar marca a taxa como estornada, sem apagar, e some dos totais', async () => {
        const vendaId = vendasCriadas.A[1]; // a de R$ 115,00 (taxa R$ 0,17)
        const antes = await listar();

        const res = await request(app)
            .patch(`/vendas/${vendaId}/cancelar`)
            .set('Authorization', `Bearer ${empresas.A.tokens.admin}`);

        expect(res.status).toBe(200);

        const [taxa] = await taxasDaVenda(vendaId);
        expect(taxa).toMatchObject({ status: 'estornada', valor: '0.17', base_calculo: '115.00' }); // valor preservado
        expect(taxa.estornado_em).not.toBeNull();

        const depois = await listar();
        expect(depois.body.data.total).toBe(antes.body.data.total); // a linha continua existindo (auditoria)
        const diff = Math.round((Number(antes.body.data.totais.total_taxa) - Number(depois.body.data.totais.total_taxa)) * 100);
        expect(diff).toBe(17); // totais só contam as apuradas

        function listar() {
            return request(app).get('/financeiro/taxas-venda?pageSize=100').set('Authorization', `Bearer ${empresas.A.tokens.admin}`);
        }
    });

    test('cancelar de novo é bloqueado (409) e a taxa continua estornada uma única vez', async () => {
        const vendaId = vendasCriadas.A[1];

        const res = await request(app)
            .patch(`/vendas/${vendaId}/cancelar`)
            .set('Authorization', `Bearer ${empresas.A.tokens.admin}`);

        expect(res.status).toBe(409);
        expect((await taxasDaVenda(vendaId))[0].status).toBe('estornada');
    });

    test('admin de outra empresa não consegue cancelar (nem estornar a taxa) de uma venda alheia', async () => {
        const vendaId = vendasCriadas.A[0];

        const res = await request(app)
            .patch(`/vendas/${vendaId}/cancelar`)
            .set('Authorization', `Bearer ${empresas.B.tokens.admin}`);

        expect(res.status).toBe(404);
        expect((await taxasDaVenda(vendaId))[0].status).toBe('apurada');
    });

    test('venda histórica sem taxa (anterior à ativação) cancela normalmente: estorno é no-op', async () => {
        // Simula venda anterior à ativação: remove a taxa de uma venda recém-criada.
        const res = await venda('A', { itens: [{ produto_id: empresas.A.produtos.caro, quantidade: 1 }] });
        expect(res.status).toBe(201);
        const vendaId = res.body.data.id;
        vendasCriadas.A.push(vendaId);

        await db.query('DELETE FROM taxas_venda WHERE venda_id = $1', [vendaId]);
        vendasCriadas.A.pop(); // não deve mais aparecer como "com taxa" nos próximos asserts

        const cancel = await request(app)
            .patch(`/vendas/${vendaId}/cancelar`)
            .set('Authorization', `Bearer ${empresas.A.tokens.admin}`);

        expect(cancel.status).toBe(200);
        expect(await taxasDaVenda(vendaId)).toHaveLength(0); // nenhuma taxa criada retroativamente
    });
});
