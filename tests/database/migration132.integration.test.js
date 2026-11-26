// Comportamento da migration 132 no banco de testes (TEST_DATABASE_URL validada pelo globalSetup):
// o BANCO recusa referência entre empresas nas colunas que só tinham FK simples.
const crypto = require('node:crypto');
const db = require('../../src/config/db');
const { criarRegistroDeEmpresas } = require('../helpers/limpezaEmpresasTeste');

const sufixo = crypto.randomBytes(4).toString('hex');
const registro = criarRegistroDeEmpresas(db);

let e1;
let e2;
let fornecedorE2;
let fornecedorE1;
let produtoE2;
let canalE1;

async function criarEmpresa(rotulo) {
    const { rows } = await db.query(`INSERT INTO empresas (nome, cnpj, status) VALUES ($1, NULL, 'ativa') RETURNING id`, [`Empresa Teste FK ${rotulo} ${sufixo}`]);
    return registro.registrar(rows[0].id);
}

beforeAll(async () => {
    e1 = await criarEmpresa('1');
    e2 = await criarEmpresa('2');
    fornecedorE1 = (await db.query(`INSERT INTO fornecedores (empresa_id, nome) VALUES ($1, 'Forn E1') RETURNING id`, [e1])).rows[0].id;
    fornecedorE2 = (await db.query(`INSERT INTO fornecedores (empresa_id, nome) VALUES ($1, 'Forn E2') RETURNING id`, [e2])).rows[0].id;
    produtoE2 = (await db.query(`INSERT INTO produtos (empresa_id, nome, preco_venda, custo) VALUES ($1, 'Prod E2', 10, 5) RETURNING id`, [e2])).rows[0].id;
    canalE1 = (await db.query(`INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`, [e1])).rows[0].id;
});

afterAll(async () => {
    try {
        await registro.limpar();
    } finally {
        await db.end();
    }
});

const inserirCompra = (empresaId, fornecedorId) => db.query(
    `INSERT INTO compras (empresa_id, fornecedor_id, data_compra, forma_pagamento, status, valor_total)
     VALUES ($1, $2, '2026-11-01', 'a_vista', 'recebido', 0) RETURNING id`,
    [empresaId, fornecedorId]
);

describe('migration 132 — o banco recusa referência entre empresas', () => {
    test('as FKs compostas existem (>= 100 constraints *_empresa_fk da 132)', async () => {
        const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND conname LIKE '%\\_empresa\\_fk' AND connamespace = 'public'::regnamespace`);
        expect(rows[0].n).toBeGreaterThanOrEqual(100);
    });

    test('compra da empresa 1 com fornecedor da empresa 2 é recusada (23503); com o próprio fornecedor, aceita', async () => {
        await expect(inserirCompra(e1, fornecedorE2)).rejects.toMatchObject({ code: '23503' });
        await expect(inserirCompra(e1, fornecedorE1)).resolves.toBeDefined();
    });

    test('preço da empresa 1 apontando para produto da empresa 2 é recusado (23503)', async () => {
        await expect(db.query(
            `INSERT INTO precos_produto (produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, empresa_id)
             VALUES ($1, $2, 10, 0, 0, $3)`,
            [produtoE2, canalE1, e1]
        )).rejects.toMatchObject({ code: '23503' });
    });
});
