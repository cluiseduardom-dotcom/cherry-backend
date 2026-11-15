// Integração (Postgres real): sugestão de título para um movimento de ENTRADA do extrato quando a conta foi recebida em parte.
// Casa pelo valor total, pelo que FALTA da conta e pelo recebimento parcial (ex.: Pix de R$ 40 numa parcela de R$ 100).
jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(4).toString('hex');
const HASH = bcrypt.hashSync(crypto.randomBytes(8).toString('hex'), 4);
const A = { u: {} };
const B = { u: {} };
const dia = (n) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const br = (n) => dia(n).split('-').reverse().join('/');

const auth = (req, alvo, papel = 'admin') => req.set('Authorization', `Bearer ${makeToken({ id: alvo.u[papel], role: papel, empresa_id: alvo.empresaId, tv: 0 })}`);

async function criarEmpresa(alvo, rotulo) {
    alvo.empresaId = registro.registrar((await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste SugParcial ${rotulo} ${sufixo}`])).rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;

    for (const papel of ['admin', 'vendedor']) {
        alvo.u[papel] = (await db.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [alvo.empresaId, `${papel} ${sufixo}`, `${papel}-${alvo.empresaId}-${sufixo}@teste.invalid`, HASH, papel]
        )).rows[0].id;
    }
}

async function movimentoDeEntrada(alvo, valor, diasAtras = 0) {
    const nome = `Entrada ${valor} ${crypto.randomBytes(3).toString('hex')}`;
    const imp = await auth(request(app).post('/bancos/importacoes'), alvo).send({ conta_bancaria_id: alvo.conta, conteudo: `Data;Descrição;Valor\n${br(diasAtras)};${nome};${String(valor).replace('.', ',')}` });

    expect(imp.status).toBe(201);

    return (await db.query(`SELECT id FROM movimentos_bancarios WHERE conta_bancaria_id = $1 AND descricao = $2`, [alvo.conta, nome])).rows[0].id;
}

const sugestoes = (alvo, mov, papel = 'admin') => auth(request(app).get(`/bancos/movimentos/${mov}/sugestoes`), alvo, papel);

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    const c = await auth(request(app).post('/bancos/contas'), A).send({ nome: 'Itaú', tipo: 'CONTA_CORRENTE', saldo_inicial: 0, data_saldo_inicial: dia(30) });
    expect(c.status).toBe(201);
    A.conta = Number(c.body.data.id);

    A.produtoId = (await db.query(`INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, 'P', 100, 10, 500) RETURNING id`, [A.empresaId])).rows[0].id;
    await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`, [A.empresaId]);
    await db.query(`INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo) SELECT $1, l.id, $2, 500 FROM locais_estoque l WHERE l.empresa_id = $2 AND l.tipo = 'central'`, [A.produtoId, A.empresaId]);
    await db.query(`INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, 100, 900, 90)`, [A.empresaId, A.produtoId, A.canalId]);
    A.clienteId = (await db.query(`INSERT INTO clientes (empresa_id, nome, telefone, criado_por) VALUES ($1, 'Cliente', '(11) 91234-5678', $2) RETURNING id`, [A.empresaId, A.u.vendedor])).rows[0].id;
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('sugestão de título para entrada do extrato com recebimento parcial', () => {
    let contaId;

    beforeAll(async () => {
        const venda = await auth(request(app).post('/vendas'), A, 'vendedor').send({
            cliente_id: A.clienteId, itens: [{ produto_id: A.produtoId, quantidade: 1 }],
            pagamentos: [{ forma_pagamento: 'crediario', valor: 100, numero_parcelas: 1, meses_prazo: 1 }]
        });

        expect(venda.status).toBe(201);
        contaId = (await db.query('SELECT id FROM contas_receber WHERE venda_id = $1', [venda.body.data.id])).rows[0].id;
        // O vencimento do crediário é daqui a 1 mês, fora da janela de ±15 dias das sugestões: traz para hoje.
        await db.query('UPDATE contas_receber SET data_vencimento = $2 WHERE id = $1', [contaId, dia(0)]);
    });

    test('conta intacta: casa pelo valor total (como sempre foi)', async () => {
        const s = await sugestoes(A, await movimentoDeEntrada(A, 100));

        expect(s.body.data).toEqual([expect.objectContaining({ tipo_titulo: 'conta_receber', id: contaId, motivo: 'valor_total', valor: '100.00', valor_restante: '100.00' })]);
    });

    test('depois de receber R$ 40: o movimento de 40 casa como recebimento parcial; o de 60, como o que faltava; o de 100 não casa mais', async () => {
        const r = await auth(request(app).post(`/contas-receber/${contaId}/recebimentos`), A).set('Idempotency-Key', crypto.randomUUID()).send({ valor: 40, forma_pagamento: 'pix' });

        expect(r.status).toBe(201);

        expect((await sugestoes(A, await movimentoDeEntrada(A, 40))).body.data).toEqual([expect.objectContaining({ id: contaId, motivo: 'recebimento_parcial', valor_restante: '60.00' })]);
        expect((await sugestoes(A, await movimentoDeEntrada(A, 60))).body.data).toEqual([expect.objectContaining({ id: contaId, motivo: 'valor_restante' })]);
        expect((await sugestoes(A, await movimentoDeEntrada(A, 100))).body.data).toEqual([]);
    });

    test('recebimento parcial longe da data do movimento não casa; valor diferente não casa', async () => {
        expect((await sugestoes(A, await movimentoDeEntrada(A, 40, 10))).body.data).toEqual([]);
        expect((await sugestoes(A, await movimentoDeEntrada(A, 41))).body.data).toEqual([]);
    });

    test('outra empresa e o vendedor não acessam', async () => {
        const mov = await movimentoDeEntrada(A, 60);

        expect((await sugestoes(B, mov)).status).toBe(404);
        expect((await sugestoes(A, mov, 'vendedor')).status).toBe(403);
    });
});
