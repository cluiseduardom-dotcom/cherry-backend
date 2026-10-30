// Integração de verdade: o Histórico (GET /vendas e GET /vendas/:id) mostra COMO a venda foi paga,
// só com campos de exibição, e só da própria empresa.
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
const SENHA_HASH = bcrypt.hashSync(crypto.randomBytes(10).toString('hex'), 4);

const A = { u: {} };
const B = { u: {} };

async function criarEmpresa(alvo, rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste FormasPag ${rotulo} ${sufixo}`]);
    alvo.empresaId = registro.registrar(rows[0].id);
    alvo.canalId = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [alvo.empresaId])).rows[0].id;
}

async function criarUsuario(alvo, papel, rotulo = papel) {
    const { rows } = await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [alvo.empresaId, `${rotulo} ${sufixo}`, `${rotulo}-${alvo.empresaId}-${sufixo}@teste.invalid`, SENHA_HASH, papel]
    );
    alvo.u[rotulo] = rows[0].id;
}

const ligarCargo = (alvo, cargo, nivel, capacidades) => db.query(
    `INSERT INTO cargos_empresa (empresa_id, cargo, nivel, ativo, capacidades) VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (empresa_id, cargo) DO UPDATE SET nivel = $3, ativo = true, capacidades = $4`,
    [alvo.empresaId, cargo, nivel, capacidades]
);

async function criarProduto(alvo, preco = 100) {
    const { rows } = await db.query(
        `INSERT INTO produtos (empresa_id, nome, preco_venda, custo, estoque_atual) VALUES ($1, $2, $3, 10, 500) RETURNING id`,
        [alvo.empresaId, `Produto ${sufixo}`, preco]
    );
    // Estoque por local: o saldo inserido direto precisa existir também no Central.
    await db.query(`INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`, [alvo.empresaId]);
    await db.query(
        `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo)
         SELECT $1, l.id, $2, 500 FROM locais_estoque l WHERE l.empresa_id = $2 AND l.tipo = 'central'`,
        [rows[0].id, alvo.empresaId]
    );
    await db.query(
        `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual) VALUES ($1, $2, $3, $4, 900, 90)`,
        [alvo.empresaId, rows[0].id, alvo.canalId, preco]
    );

    return rows[0].id;
}

// O JWT diz sempre "vendedor" de propósito: quem vale é o banco.
const auth = (alvo, rotulo) => ({ Authorization: `Bearer ${makeToken({ id: alvo.u[rotulo], role: 'vendedor', empresa_id: alvo.empresaId, tv: 0 })}` });

const vender = (alvo, rotulo, corpo) =>
    request(app).post('/vendas').set(auth(alvo, rotulo)).send({ itens: [{ produto_id: alvo.produtoId, quantidade: 1 }], ...corpo });

const comissaoDaVenda = async (vendaId) => (await db.query('SELECT * FROM comissoes_venda WHERE venda_id = $1', [vendaId])).rows[0];
const eventosDaComissao = async (comissaoId) => (await db.query('SELECT * FROM comissoes_eventos WHERE comissao_id = $1 ORDER BY id', [comissaoId])).rows;
const repassesDaVenda = async (vendaId) => (await db.query('SELECT * FROM comissao_repasses WHERE venda_id = $1 ORDER BY id', [vendaId])).rows;

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');

    for (const papel of ['admin', 'gerente', 'vendedor']) await criarUsuario(A, papel);
    await criarUsuario(A, 'vendedor', 'vendedor2');
    await criarUsuario(B, 'gerente');
    await criarUsuario(B, 'vendedor');

    // Gerente vem desligado por padrão: a empresa liga e ele passa a ver a equipe.
    await ligarCargo(A, 'gerente', 70, ['ver_vendas_de_todos']);
    await ligarCargo(B, 'gerente', 70, ['ver_vendas_de_todos']);

    for (const alvo of [A, B]) {
        await db.query(`INSERT INTO comissao_percentuais (empresa_id, usuario_id, percentual) VALUES ($1, NULL, 10)`, [alvo.empresaId]);
        alvo.produtoId = await criarProduto(alvo, 100);
        alvo.clienteId = (await db.query(`INSERT INTO clientes (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [alvo.empresaId, `Cliente ${sufixo}`])).rows[0].id;
    }
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});


const listar = (alvo, rotulo, query = '') => request(app).get(`/vendas${query}`).set(auth(alvo, rotulo));

describe('forma de pagamento no Histórico', () => {
    let vendaMista;
    let vendaPix;

    test('GET /vendas traz as formas e valores de cada pagamento, na ordem lançada', async () => {
        vendaMista = (await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'dinheiro', valor: 40, valor_recebido: 50 }, { forma_pagamento: 'pix', valor: 60 }] })).body.data.id;
        vendaPix = (await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] })).body.data.id;

        const res = await listar(A, 'vendedor');
        expect(res.status).toBe(200);

        const mista = res.body.data.items.find((v) => v.id === vendaMista);
        expect(mista.pagamentos.map((p) => [p.forma_pagamento, p.valor, p.status])).toEqual([['dinheiro', '40.00', 'pago'], ['pix', '60.00', 'pago']]);

        const pix = res.body.data.items.find((v) => v.id === vendaPix);
        expect(pix.pagamentos.map((p) => p.forma_pagamento)).toEqual(['pix']);
    });

    test('o detalhe traz valor recebido, troco e parcelas, sem dados de gateway', async () => {
        const res = await request(app).get(`/vendas/${vendaMista}`).set(auth(A, 'vendedor'));

        expect(res.status).toBe(200);
        expect(res.body.data.pagamentos[0]).toMatchObject({ forma_pagamento: 'dinheiro', valor: '40.00', valor_recebido: '50.00', troco: '10.00', numero_parcelas: 1 });
        expect(Object.keys(res.body.data.pagamentos[0]).sort()).toEqual(['forma_pagamento', 'id', 'numero_parcelas', 'status', 'troco', 'valor', 'valor_recebido']);
        expect(JSON.stringify(res.body)).not.toMatch(/nsu|provedor|autorizacao|transacao_externa/i);
    });

    test('a listagem nunca mistura pagamentos de outra empresa', async () => {
        await vender(B, 'vendedor', { pagamentos: [{ forma_pagamento: 'credito', valor: 100, numero_parcelas: 2 }] });

        const res = await listar(A, 'vendedor');
        expect(res.body.data.items.flatMap((v) => v.pagamentos.map((p) => p.forma_pagamento))).not.toContain('credito');
    });

    test('venda sem linhas de pagamento (anterior ao módulo) volta pagamentos [] e mantém forma_pagamento legado', async () => {
        const { rows: [v] } = await db.query(
            `INSERT INTO vendas (canal_id, usuario_id, subtotal, desconto, juros, total, status, data, empresa_id, forma_pagamento)
             VALUES ($1, $2, 100, 0, 0, 100, 'finalizada', NOW(), $3, 'a_vista') RETURNING id`,
            [A.canalId, A.u.vendedor, A.empresaId]
        );

        const res = await listar(A, 'vendedor');
        const legada = res.body.data.items.find((x) => x.id === v.id);
        expect(legada.pagamentos).toEqual([]);
        expect(legada.forma_pagamento).toBe('a_vista');
    });
});

describe('vendedor (nome e foto) no Histórico', () => {
    test('GET /vendas e GET /vendas/:id trazem nome e URL pública da foto (nunca a chave); sem foto é null; isolado por empresa', async () => {
        const chave = `${A.empresaId}/usuarios/${A.u.vendedor}/${crypto.randomUUID()}.webp`;
        const baseAnterior = process.env.R2_PUBLIC_BASE_URL;
        process.env.R2_PUBLIC_BASE_URL = 'https://fotos.exemplo.test';

        await db.query(
            `INSERT INTO usuarios_fotos (usuario_id, empresa_id, chave, content_type, tamanho_bytes) VALUES ($1, $2, $3, 'image/webp', 10)`,
            [A.u.vendedor, A.empresaId, chave]
        );

        try {
            const comFoto = (await vender(A, 'vendedor', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] })).body.data.id;
            const semFoto = (await vender(A, 'vendedor2', { pagamentos: [{ forma_pagamento: 'pix', valor: 100 }] })).body.data.id;

            const lista = (await listar(A, 'gerente', '?pageSize=100')).body.data.items;
            const a = lista.find((v) => v.id === comFoto);
            const b = lista.find((v) => v.id === semFoto);

            expect(a.vendedor_nome).toBe(`vendedor ${sufixo}`);
            expect(a.vendedor_foto_url).toBe(`https://fotos.exemplo.test/${chave}`);
            expect(b.vendedor_nome).toBe(`vendedor2 ${sufixo}`);
            expect(b.vendedor_foto_url).toBeNull();
            expect(lista.every((v) => !('vendedor_foto_chave' in v))).toBe(true);

            const detalhe = await request(app).get(`/vendas/${comFoto}`).set(auth(A, 'gerente'));
            expect(detalhe.body.data.vendedor_foto_url).toBe(`https://fotos.exemplo.test/${chave}`);
            expect('vendedor_foto_chave' in detalhe.body.data).toBe(false);

            // Outra empresa nunca enxerga a foto nem o nome do vendedor da empresa A.
            const deB = (await listar(B, 'gerente', '?pageSize=100')).body.data.items;
            expect(deB.some((v) => v.vendedor_nome?.includes(`vendedor ${sufixo}`) && v.vendedor_foto_url)).toBe(false);
        } finally {
            await db.query('DELETE FROM usuarios_fotos WHERE usuario_id = $1 AND empresa_id = $2', [A.u.vendedor, A.empresaId]);
            if (baseAnterior === undefined) delete process.env.R2_PUBLIC_BASE_URL;
            else process.env.R2_PUBLIC_BASE_URL = baseAnterior;
        }
    });
});
