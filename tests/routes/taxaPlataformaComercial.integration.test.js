// Integração de verdade (Postgres real da CI/dev, sem mock de db/sessão): taxa interna
// da plataforma (VERTUMNO/GiroNex) com modelo comercial configurável — plano sem
// mensalidade (0,15%), plano com mensalidade (0,10%) e condição individual negociada
// por empresa (inclusive 0%), com prioridade, vigência, congelamento e auditoria.
//
// Cria QUATRO empresas temporárias próprias (cada uma com admin, canal, produto e
// preço) e remove tudo no afterAll; não depende do seed. As políticas globais
// (migrations 046/048) são só LIDAS: o que "mexe" nelas o faz em transação própria
// NÃO confirmada (ROLLBACK), para não interferir em outras suítes no mesmo banco.
//
// Produto de R$ 1.000,00 em todas as empresas:
//   0,15% = R$ 1,50 | 0,10% = R$ 1,00 | 0,05% = R$ 0,50 | 0% = R$ 0,00

jest.setTimeout(60000);

jest.unmock('../../src/repositories/sessaoRepository');

const crypto = require('node:crypto');
const path = require('node:path');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { Client } = require('pg');
const db = require('../../src/config/db');
const app = require('../../src/app');
const taxasPlataformaRepository = require('../../src/repositories/taxasPlataformaRepository');
const { executarArquivoSql } = require('../../src/database/migrate');
const { criarRegistroDeEmpresas, removerEmpresasPorNome, removerCancelamentosDeTeste } = require('../helpers/limpezaEmpresasTeste');

// Cada empresa é registrada LOGO APÓS o INSERT (antes de login/produto/preço): se a
// preparação falhar no meio, o afterAll ainda remove o que foi criado.
const registro = criarRegistroDeEmpresas(db);

const SUFIXO = crypto.randomBytes(4).toString('hex');
const SENHA = crypto.randomBytes(12).toString('hex');
const RESPONSAVEL = 'teste.gironex@teste.invalid';
const JUSTIFICATIVA = 'Condição comercial negociada (teste automatizado)';

const empresas = {}; // { SEM, COM, EXC, ZERO } -> { id, canalId, produto, token }

async function dia(deslocamento = 0) {
    const { rows } = await db.query(
        `SELECT ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date + $1::int)::text AS d`,
        [deslocamento]
    );
    return rows[0].d;
}

const planoId = async (codigo, client = db) =>
    (await client.query('SELECT id FROM planos_comerciais WHERE codigo = $1', [codigo])).rows[0].id;

async function criarEmpresa(rotulo) {
    const emp = await db.query(
        `INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`,
        [`Teste Taxa Comercial ${rotulo} ${SUFIXO}`]
    );
    const id = registro.registrar(emp.rows[0].id);
    const canal = await db.query(
        `INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES ($1, 'loja_fisica', true) RETURNING id`,
        [id]
    );
    const canalId = canal.rows[0].id;

    const email = `taxacom-${rotulo.toLowerCase()}-${SUFIXO}@teste.invalid`;
    await db.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, $2, $3, $4, 'admin')`,
        [id, `Teste admin ${rotulo}`, email, await bcrypt.hash(SENHA, 4)]
    );
    const login = await request(app).post('/auth/login').send({ email, senha: SENHA });
    if (login.status !== 200) throw new Error(`login ${email}: ${login.status}`);
    const token = login.body.data.token;

    const prod = await request(app)
        .post('/produtos')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: `Joia ${rotulo}`, preco_venda: 1000, custo: 10, estoque_atual: 200, estoque_minimo: 1 });
    if (prod.status !== 201) throw new Error(`produto ${rotulo}: ${prod.status} ${JSON.stringify(prod.body)}`);
    const produto = prod.body.data.id;

    const preco = await request(app)
        .put(`/produtos/${produto}/precos/${canalId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ preco_venda: 1000 });
    if (preco.status !== 201) throw new Error(`preço ${rotulo}: ${preco.status}`);

    empresas[rotulo] = { id, canalId, produto, token };
}

async function criarCondicao(empresaId, { percentual, inicio, fim = null, substituiId = null, justificativa = JUSTIFICATIVA, responsavel = RESPONSAVEL }, client = db) {
    const { rows } = await client.query(
        `INSERT INTO condicoes_comerciais_empresa
            (empresa_id, percentual, vigencia_inicio, vigencia_fim, substitui_id, justificativa, responsavel)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [empresaId, percentual, inicio, fim, substituiId, justificativa, responsavel]
    );
    return rows[0].id;
}

async function criarPlanoEmpresa(empresaId, codigo, { inicio, fim = null }, client = db) {
    const { rows } = await client.query(
        `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, vigencia_fim, justificativa, responsavel)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [empresaId, await planoId(codigo, client), inicio, fim, JUSTIFICATIVA, RESPONSAVEL]
    );
    return rows[0].id;
}

const vender = (rotulo, corpo = {}, cabecalhos = {}) => {
    const req = request(app).post('/vendas').set('Authorization', `Bearer ${empresas[rotulo].token}`);
    Object.entries(cabecalhos).forEach(([k, v]) => req.set(k, v));
    // A taxa incide só sobre o Pix: por padrão a venda de teste (R$ 1.000,00) é paga toda em Pix.
    return req.send({
        itens: [{ produto_id: empresas[rotulo].produto, quantidade: 1 }],
        pagamentos: [{ forma_pagamento: 'pix', valor: 1000 }],
        ...corpo
    });
};

async function venderOk(rotulo, corpo, cabecalhos) {
    const res = await vender(rotulo, corpo, cabecalhos);
    if (res.status !== 201) throw new Error(`venda ${rotulo}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.data.id;
}

async function taxaDaVenda(vendaId) {
    const { rows } = await db.query(
        `SELECT t.*, p.codigo AS plano_codigo
         FROM taxas_venda t JOIN planos_comerciais p ON p.id = t.plano_id
         WHERE t.venda_id = $1`,
        [vendaId]
    );
    return rows;
}

async function contar(tabela, empresaId) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${tabela} WHERE empresa_id = $1`, [empresaId]);
    return rows[0].n;
}

beforeAll(async () => {
    for (const rotulo of ['SEM', 'COM', 'EXC', 'ZERO']) {
        await criarEmpresa(rotulo);
    }
});

afterAll(async () => {
    try {
        for (const id of registro.ids()) {
            await db.query('DELETE FROM taxas_venda WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM estornos_pagamento WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM parcelas_pagamento WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM pagamentos_venda WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM idempotency_keys WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM itens_venda WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM movimentacoes_estoque WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM estoque_locais WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM locais_estoque WHERE empresa_id = $1', [id]);
            await removerCancelamentosDeTeste(db, id);
            await db.query('DELETE FROM vendas WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM condicoes_comerciais_empresa WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM empresa_planos WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM precos_produto WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM produtos WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM canais_venda WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM usuarios WHERE empresa_id = $1', [id]);
            await db.query('DELETE FROM empresas WHERE id = $1', [id]);
        }
    } finally {
        // Rede de segurança: remove o que a limpeza acima deixou (ou tudo, se ela falhou
        // ou se a preparação quebrou antes de a empresa ser usada).
        try {
            await registro.limpar();
            await removerEmpresasPorNome(db, `Teste Taxa Comercial % ${SUFIXO}`);
        } finally {
            await db.end();
        }
    }
});

afterEach(() => jest.restoreAllMocks());

describe('catálogo de planos e políticas por plano (migration 048)', () => {
    test('existem os planos e as políticas padrão: sem mensalidade 0,15% e com mensalidade 0,10%', async () => {
        const { rows } = await db.query(
            `SELECT p.codigo, p.tem_mensalidade, t.percentual::text, t.vigencia_inicio::text, t.vigencia_fim, t.ativo
             FROM planos_comerciais p JOIN politicas_taxa_plataforma t ON t.plano_id = p.id
             WHERE p.codigo IN ('sem_mensalidade', 'com_mensalidade') AND t.ativo ORDER BY p.codigo`
        );

        expect(rows).toEqual([
            { codigo: 'com_mensalidade', tem_mensalidade: true, percentual: '0.1000', vigencia_inicio: '2026-10-09', vigencia_fim: null, ativo: true },
            { codigo: 'sem_mensalidade', tem_mensalidade: false, percentual: '0.1500', vigencia_inicio: '2026-10-09', vigencia_fim: null, ativo: true }
        ]);
    });

    test('as políticas continuam globais: nenhuma tabela de política tem empresa_id', async () => {
        const { rows } = await db.query(
            `SELECT table_name FROM information_schema.columns
             WHERE column_name = 'empresa_id' AND table_name IN ('politicas_taxa_plataforma', 'planos_comerciais')`
        );
        expect(rows).toEqual([]);
    });

    test('duas políticas ativas sobrepostas do MESMO plano são rejeitadas; planos diferentes convivem', async () => {
        const client = await db.connect();
        try {
            const com = await planoId('com_mensalidade', client);

            await client.query('BEGIN');
            await expect(
                client.query(`INSERT INTO politicas_taxa_plataforma (percentual, vigencia_inicio, ativo, plano_id) VALUES (1, DATE '2027-01-01', true, $1)`, [com])
            ).rejects.toMatchObject({ code: '23P01' });
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });

    test('a migration 048 é idempotente: reexecutar o arquivo SQL sobre o banco já migrado não falha nem duplica dados', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await executarArquivoSql(client, path.join(__dirname, '../../src/database/migrations/048_planos_comerciais_taxa_plataforma.sql'));

            const planos = await client.query(`SELECT count(*)::int AS n FROM planos_comerciais WHERE codigo IN ('sem_mensalidade', 'com_mensalidade')`);
            const politicas = await client.query(
                `SELECT count(*)::int AS n FROM politicas_taxa_plataforma t JOIN planos_comerciais p ON p.id = t.plano_id
                 WHERE t.ativo AND p.codigo IN ('sem_mensalidade', 'com_mensalidade')`
            );
            expect(planos.rows[0].n).toBe(2);
            expect(politicas.rows[0].n).toBe(2);
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });

    test('catálogo da migration 077: cortesia 0,50% (sem mensalidade), básico 0,50%, padrão 0,40% e Pro 0,30% (com mensalidade), vigentes desde 30/10/2026', async () => {
        const { rows } = await db.query(
            `SELECT p.codigo, p.tem_mensalidade, t.percentual::text, t.vigencia_inicio::text, t.vigencia_fim, t.ativo
             FROM planos_comerciais p JOIN politicas_taxa_plataforma t ON t.plano_id = p.id
             WHERE p.codigo IN ('cortesia', 'basico', 'padrao', 'pro') ORDER BY p.codigo`
        );

        expect(rows).toEqual([
            { codigo: 'basico', tem_mensalidade: true, percentual: '0.5000', vigencia_inicio: '2026-10-30', vigencia_fim: null, ativo: true },
            { codigo: 'cortesia', tem_mensalidade: false, percentual: '0.5000', vigencia_inicio: '2026-10-30', vigencia_fim: null, ativo: true },
            { codigo: 'padrao', tem_mensalidade: true, percentual: '0.4000', vigencia_inicio: '2026-10-30', vigencia_fim: null, ativo: true },
            { codigo: 'pro', tem_mensalidade: true, percentual: '0.3000', vigencia_inicio: '2026-10-30', vigencia_fim: null, ativo: true }
        ]);
    });

    test('a migration 077 é idempotente: reexecutar o arquivo não falha nem duplica planos e políticas', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await executarArquivoSql(client, path.join(__dirname, '../../src/database/migrations/077_planos_comerciais_catalogo.sql'));

            const planos = await client.query(`SELECT count(*)::int AS n FROM planos_comerciais WHERE codigo IN ('cortesia', 'basico', 'padrao', 'pro')`);
            const politicas = await client.query(
                `SELECT count(*)::int AS n FROM politicas_taxa_plataforma t JOIN planos_comerciais p ON p.id = t.plano_id
                 WHERE p.codigo IN ('cortesia', 'basico', 'padrao', 'pro')`
            );
            expect(planos.rows[0].n).toBe(4);
            expect(politicas.rows[0].n).toBe(4);
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });
});

describe('plano padrão: empresa sem plano cadastrado (0,15%)', () => {
    test('R$ 1.000,00 gera R$ 1,50, com origem padrao_sem_plano e plano sem_mensalidade congelados', async () => {
        const vendaId = await venderOk('SEM');

        const [taxa] = await taxaDaVenda(vendaId);
        expect(taxa).toMatchObject({
            empresa_id: empresas.SEM.id,
            percentual: '0.1500',
            base_calculo: '1000.00',
            valor: '1.50',
            origem: 'padrao_sem_plano',
            plano_codigo: 'sem_mensalidade',
            empresa_plano_id: null,
            condicao_id: null,
            status: 'apurada'
        });
    });
});

describe('plano com mensalidade (0,10%) e mudança de plano sem efeito retroativo', () => {
    let vendaAntesId;
    let empresaPlanoId;

    test('empresa com plano com_mensalidade vigente paga 0,10%: R$ 1,00 e referência do plano da empresa', async () => {
        empresaPlanoId = await criarPlanoEmpresa(empresas.COM.id, 'com_mensalidade', { inicio: await dia(-3) });

        vendaAntesId = await venderOk('COM');

        const [taxa] = await taxaDaVenda(vendaAntesId);
        expect(taxa).toMatchObject({
            percentual: '0.1000',
            valor: '1.00',
            origem: 'plano_padrao',
            plano_codigo: 'com_mensalidade',
            empresa_plano_id: empresaPlanoId,
            condicao_id: null
        });
    });

    test('mudar o plano da empresa NÃO recalcula a venda histórica; a próxima venda usa a nova regra', async () => {
        await db.query('UPDATE empresa_planos SET ativo = false WHERE id = $1', [empresaPlanoId]); // encerra o plano
        const vendaDepoisId = await venderOk('COM');

        const [antes] = await taxaDaVenda(vendaAntesId);
        expect(antes).toMatchObject({ percentual: '0.1000', valor: '1.00', plano_codigo: 'com_mensalidade', origem: 'plano_padrao' });

        const [depois] = await taxaDaVenda(vendaDepoisId);
        expect(depois).toMatchObject({ percentual: '0.1500', valor: '1.50', origem: 'padrao_sem_plano', plano_codigo: 'sem_mensalidade' });
    });

    test('plano expirado (vigencia_fim no passado) também volta ao padrão sem mensalidade', async () => {
        await criarPlanoEmpresa(empresas.COM.id, 'com_mensalidade', { inicio: await dia(-20), fim: await dia(-10) });

        const vendaId = await venderOk('COM');

        const [taxa] = await taxaDaVenda(vendaId);
        expect(taxa).toMatchObject({ origem: 'padrao_sem_plano', valor: '1.50' });
    });

    test('plano futuro ainda não vale', async () => {
        await criarPlanoEmpresa(empresas.COM.id, 'com_mensalidade', { inicio: await dia(5) });

        const vendaId = await venderOk('COM');

        expect((await taxaDaVenda(vendaId))[0]).toMatchObject({ origem: 'padrao_sem_plano', valor: '1.50' });
    });
});

describe('condição individual negociada prevalece sobre o plano', () => {
    let condicaoExcId;

    test('exceção de 0,05% sobre o plano com mensalidade: R$ 0,50, com condicao_id e a política do plano congeladas', async () => {
        await criarPlanoEmpresa(empresas.EXC.id, 'com_mensalidade', { inicio: await dia(-3) });
        condicaoExcId = await criarCondicao(empresas.EXC.id, { percentual: 0.05, inicio: await dia(-1) });

        const vendaId = await venderOk('EXC');

        const [taxa] = await taxaDaVenda(vendaId);
        expect(taxa).toMatchObject({
            percentual: '0.0500',
            valor: '0.50',
            origem: 'excecao_empresa',
            condicao_id: condicaoExcId,
            plano_codigo: 'com_mensalidade'
        });

        const politica = await db.query('SELECT p.codigo, t.percentual::text FROM politicas_taxa_plataforma t JOIN planos_comerciais p ON p.id = t.plano_id WHERE t.id = $1', [taxa.politica_id]);
        expect(politica.rows[0]).toEqual({ codigo: 'com_mensalidade', percentual: '0.1000' }); // política aplicada = a do plano
    });

    test('a exceção de uma empresa não afeta as outras (isolamento): COM continua pagando o padrão', async () => {
        const vendaId = await venderOk('COM');

        const [taxa] = await taxaDaVenda(vendaId);
        expect(taxa.empresa_id).toBe(empresas.COM.id);
        expect(taxa).toMatchObject({ origem: 'padrao_sem_plano', valor: '1.50', condicao_id: null });
    });

    test('exceção de 0%: a venda conclui, gera UMA linha e a taxa é R$ 0,00', async () => {
        const condicaoId = await criarCondicao(empresas.ZERO.id, { percentual: 0, inicio: await dia(-1) });

        const vendaId = await venderOk('ZERO');

        const taxas = await taxaDaVenda(vendaId);
        expect(taxas).toHaveLength(1);
        expect(taxas[0]).toMatchObject({ percentual: '0.0000', valor: '0.00', base_calculo: '1000.00', origem: 'excecao_empresa', condicao_id: condicaoId, status: 'apurada' });
    });

    test('pagamentos mistos (PIX + crédito 3x) com exceção geram UMA única taxa', async () => {
        const vendaId = await venderOk('EXC', {
            pagamentos: [
                { forma_pagamento: 'pix', valor: 400 },
                { forma_pagamento: 'credito', valor: 600, numero_parcelas: 3 }
            ]
        });

        const pagamentos = await db.query('SELECT count(*)::int AS n FROM pagamentos_venda WHERE venda_id = $1', [vendaId]);
        expect(pagamentos.rows[0].n).toBe(2);

        const taxas = await taxaDaVenda(vendaId);
        expect(taxas).toHaveLength(1);
        // exceção de 0,05% sobre a parte Pix (R$ 400,00), não sobre o total de R$ 1.000,00
        expect(taxas[0]).toMatchObject({ base_calculo: '400.00', valor: '0.20', origem: 'excecao_empresa' });
    });

    test('idempotência: replay com a mesma chave devolve a mesma venda e não gera segunda taxa', async () => {
        const corpo = { pagamentos: [{ forma_pagamento: 'pix', valor: 1000 }] };
        const chave = { 'Idempotency-Key': `taxa-com-${SUFIXO}` };

        const primeira = await vender('EXC', corpo, chave);
        const segunda = await vender('EXC', corpo, chave);

        expect(primeira.status).toBe(201);
        expect(segunda.status).toBe(201);
        expect(segunda.body.data.id).toBe(primeira.body.data.id);
        expect(await taxaDaVenda(primeira.body.data.id)).toHaveLength(1);
    });

    test('estorno: cancelar a venda marca a taxa como estornada e preserva percentual, condição e valor', async () => {
        const vendaId = await venderOk('EXC');

        const res = await request(app)
            .patch(`/vendas/${vendaId}/cancelar`)
            .set('Authorization', `Bearer ${empresas.EXC.token}`)
            .send({ motivo: 'Cancelamento de teste da taxa' });
        expect(res.status).toBe(200);

        const [taxa] = await taxaDaVenda(vendaId);
        expect(taxa).toMatchObject({ status: 'estornada', valor: '0.50', percentual: '0.0500', origem: 'excecao_empresa', condicao_id: condicaoExcId });
        expect(taxa.estornado_em).not.toBeNull();

        const de_novo = await request(app)
            .patch(`/vendas/${vendaId}/cancelar`)
            .set('Authorization', `Bearer ${empresas.EXC.token}`)
            .send({ motivo: 'Cancelamento de teste da taxa' });
        expect(de_novo.status).toBe(409);
        expect(await taxaDaVenda(vendaId)).toHaveLength(1);
    });

    test('encerrar a exceção devolve a empresa ao padrão do plano sem tocar nas vendas já feitas', async () => {
        const vendaAntes = await db.query(
            `SELECT venda_id FROM taxas_venda WHERE empresa_id = $1 AND origem = 'excecao_empresa' ORDER BY id LIMIT 1`,
            [empresas.EXC.id]
        );

        await db.query('UPDATE condicoes_comerciais_empresa SET ativo = false WHERE id = $1', [condicaoExcId]);
        const vendaId = await venderOk('EXC');

        expect((await taxaDaVenda(vendaId))[0]).toMatchObject({ origem: 'plano_padrao', percentual: '0.1000', valor: '1.00', condicao_id: null });
        expect((await taxaDaVenda(vendaAntes.rows[0].venda_id))[0]).toMatchObject({ origem: 'excecao_empresa', valor: '0.50' });
    });
});

describe('vigência das condições: expiração, futuro e troca', () => {
    test('condição expirada e condição futura são ignoradas (volta ao padrão do plano)', async () => {
        const expirada = await criarCondicao(empresas.SEM.id, { percentual: 0.05, inicio: await dia(-10), fim: await dia(-1) });
        const futura = await criarCondicao(empresas.SEM.id, { percentual: 0.02, inicio: await dia(1) });

        const vendaId = await venderOk('SEM');

        expect((await taxaDaVenda(vendaId))[0]).toMatchObject({ origem: 'padrao_sem_plano', valor: '1.50', condicao_id: null });

        // troca de vigência: encerra a futura, cria a vigente (substitui a expirada) sem sobreposição
        await db.query('UPDATE condicoes_comerciais_empresa SET ativo = false WHERE id = $1', [futura]);
        const vigente = await criarCondicao(empresas.SEM.id, { percentual: 0.02, inicio: await dia(0), substituiId: expirada });

        const vendaNovaId = await venderOk('SEM');
        expect((await taxaDaVenda(vendaNovaId))[0]).toMatchObject({ origem: 'excecao_empresa', percentual: '0.0200', valor: '0.20', condicao_id: vigente });

        // a venda anterior segue com a regra da época
        expect((await taxaDaVenda(vendaId))[0]).toMatchObject({ valor: '1.50', origem: 'padrao_sem_plano' });
    });

    test('duas condições ativas com vigência sobreposta na MESMA empresa são rejeitadas; em empresas diferentes convivem', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await expect(
                criarCondicao(empresas.SEM.id, { percentual: 0.01, inicio: await dia(0) }, client)
            ).rejects.toMatchObject({ code: '23P01' });
            await client.query('ROLLBACK');

            await client.query('BEGIN');
            await expect(
                criarCondicao(empresas.COM.id, { percentual: 0.01, inicio: await dia(0) }, client)
            ).resolves.toEqual(expect.any(Number));
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });
});

describe('auditoria: justificativa, responsável e histórico imutável', () => {
    test('justificativa e responsável são obrigatórios (nulos ou em branco são rejeitados)', async () => {
        const client = await db.connect();
        try {
            for (const dados of [
                { justificativa: '   ' },
                { justificativa: '' },
                { responsavel: '  ' },
                { responsavel: '' }
            ]) {
                await client.query('BEGIN');
                await expect(
                    criarCondicao(empresas.ZERO.id, { percentual: 0.01, inicio: await dia(-400), fim: await dia(-399), ...dados }, client)
                ).rejects.toMatchObject({ code: '23514' });
                await client.query('ROLLBACK');
            }

            await client.query('BEGIN');
            await expect(
                client.query(
                    `INSERT INTO condicoes_comerciais_empresa (empresa_id, percentual, vigencia_inicio, ativo) VALUES ($1, 0.01, DATE '2020-01-01', false)`,
                    [empresas.ZERO.id]
                )
            ).rejects.toMatchObject({ code: '23502' }); // NOT NULL
            await client.query('ROLLBACK');

            await client.query('BEGIN');
            await expect(
                criarPlanoEmpresa(empresas.ZERO.id, 'com_mensalidade', { inicio: await dia(-400), fim: await dia(-399) }, client).then(() =>
                    client.query(`UPDATE empresa_planos SET responsavel = 'outro' WHERE empresa_id = $1`, [empresas.ZERO.id]))
            ).rejects.toMatchObject({ code: '23000' });
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });

    test('percentual fora de 0..100 e vigência invertida são rejeitados', async () => {
        const client = await db.connect();
        try {
            for (const dados of [
                { percentual: 100.0001, inicio: await dia(-400), fim: await dia(-399) },
                { percentual: -0.0001, inicio: await dia(-400), fim: await dia(-399) },
                { percentual: 1, inicio: await dia(-300), fim: await dia(-301) }
            ]) {
                await client.query('BEGIN');
                await expect(criarCondicao(empresas.ZERO.id, dados, client)).rejects.toMatchObject({ code: '23514' });
                await client.query('ROLLBACK');
            }
        } finally {
            client.release();
        }
    });

    test('o histórico não é editado: percentual, vigência de início, justificativa e responsável são imutáveis; encerrar (vigencia_fim/ativo) é permitido', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const id = await criarCondicao(empresas.ZERO.id, { percentual: 0.03, inicio: await dia(-500), fim: await dia(-450) }, client);

            for (const set of [
                'percentual = 50',
                `justificativa = 'reescrita depois'`,
                `responsavel = 'outra pessoa'`,
                `vigencia_inicio = DATE '2000-01-01'`,
                'empresa_id = 1'
            ]) {
                await client.query('SAVEPOINT s');
                await expect(client.query(`UPDATE condicoes_comerciais_empresa SET ${set} WHERE id = $1`, [id])).rejects.toMatchObject({ code: '23000' });
                await client.query('ROLLBACK TO SAVEPOINT s');
            }

            await expect(
                client.query('UPDATE condicoes_comerciais_empresa SET ativo = false, vigencia_fim = $2 WHERE id = $1', [id, await dia(-451)])
            ).resolves.toMatchObject({ rowCount: 1 });
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });
});

describe('integridade multi-tenant da referência congelada em taxas_venda', () => {
    test('a taxa não pode apontar para a condição/plano de OUTRA empresa (FK composta com empresa_id)', async () => {
        const vendaId = await venderOk('COM');
        const condicaoAlheia = (await db.query(
            `SELECT id FROM condicoes_comerciais_empresa WHERE empresa_id = $1 ORDER BY id LIMIT 1`, [empresas.ZERO.id]
        )).rows[0].id;

        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await expect(
                client.query(
                    `UPDATE taxas_venda SET origem = 'excecao_empresa', condicao_id = $2 WHERE venda_id = $1`,
                    [vendaId, condicaoAlheia]
                )
            ).rejects.toMatchObject({ code: '23503' });
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });

    test('origem excecao_empresa exige condicao_id (e vice-versa)', async () => {
        const vendaId = await venderOk('COM');
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await expect(
                client.query(`UPDATE taxas_venda SET origem = 'excecao_empresa' WHERE venda_id = $1`, [vendaId])
            ).rejects.toMatchObject({ code: '23514' });
            await client.query('ROLLBACK');

            await client.query('BEGIN');
            await expect(
                client.query(`UPDATE taxas_venda SET origem = 'inventada' WHERE venda_id = $1`, [vendaId])
            ).rejects.toMatchObject({ code: '23514' });
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });
});

describe('regra decidida só pelo backend, pela empresa autenticada', () => {
    test('empresa_id, plano, percentual e taxa enviados no corpo da venda não alteram a regra aplicada', async () => {
        const res = await vender('SEM', {
            empresa_id: empresas.ZERO.id,
            plano: 'com_mensalidade',
            plano_id: 999,
            percentual: 0,
            taxa: 0,
            condicao_id: 1
        });

        if (res.status === 201) {
            const [taxa] = await taxaDaVenda(res.body.data.id);
            expect(taxa.empresa_id).toBe(empresas.SEM.id);
            expect(taxa.percentual).not.toBe('0.0000');
            expect(taxa.condicao_id).not.toBe(1);
            expect(taxa.plano_codigo).toBe('sem_mensalidade');
            expect(taxa.valor).not.toBe('0.00');
        } else {
            expect(res.status).toBe(400); // contrato estrito recusa campos desconhecidos
        }
    });

    test('não existe rota de tenant para escrever plano, condição ou política', async () => {
        const auth = { Authorization: `Bearer ${empresas.COM.token}` };
        for (const rota of ['/financeiro/planos', '/financeiro/condicoes-comerciais', '/financeiro/politicas-taxa', '/planos', '/condicoes-comerciais']) {
            for (const metodo of ['post', 'put', 'patch', 'delete']) {
                const res = await request(app)[metodo](rota).set(auth).send({ percentual: 0 });
                expect([404, 405]).toContain(res.status);
            }
        }
    });

    test('quem não é admin não consulta as taxas (403) e sem token recebe 401', async () => {
        expect((await request(app).get('/financeiro/taxas-venda')).status).toBe(401);
    });
});

describe('a taxa e a condição comercial não aparecem nas respostas de vendas', () => {
    test('POST e GET de vendas de empresas com plano, exceção e exceção 0% não expõem taxa, plano nem condição', async () => {
        const respostas = [];
        for (const rotulo of ['SEM', 'COM', 'EXC', 'ZERO']) {
            const criada = await vender(rotulo);
            respostas.push(criada);
            const auth = { Authorization: `Bearer ${empresas[rotulo].token}` };
            respostas.push(await request(app).get('/vendas').set(auth));
            respostas.push(await request(app).get(`/vendas/${criada.body.data.id}`).set(auth));
        }

        for (const res of respostas) {
            expect(res.status).toBeLessThan(300);
            expect(JSON.stringify(res.body)).not.toMatch(/taxa|vertumno|giroone|gironex|plataforma|mensalidade|condicao|politica/i);
        }
    });
});

describe('falha de cálculo ou persistência desfaz a venda inteira (rollback real)', () => {
    async function fotografia(rotulo) {
        const e = empresas[rotulo];
        return {
            vendas: await contar('vendas', e.id),
            itens: await contar('itens_venda', e.id),
            pagamentos: await contar('pagamentos_venda', e.id),
            parcelas: await contar('parcelas_pagamento', e.id),
            movimentacoes: await contar('movimentacoes_estoque', e.id),
            taxas: await contar('taxas_venda', e.id),
            idempotencia: await contar('idempotency_keys', e.id),
            estoque: (await db.query('SELECT estoque_atual FROM produtos WHERE id = $1', [e.produto])).rows[0].estoque_atual
        };
    }

    // Intercepta o pg.Client (usado por db.connect e por db.query): `intercepta`
    // devolve um resultado para substituir a consulta, ou undefined para seguir normal.
    function interceptarConsulta(intercepta) {
        const original = Client.prototype.query;
        return jest.spyOn(Client.prototype, 'query').mockImplementation(function (sql, ...resto) {
            const texto = typeof sql === 'string' ? sql : sql && sql.text;
            const resultado = texto ? intercepta(texto) : undefined;
            if (resultado instanceof Error) return Promise.reject(resultado);
            if (resultado !== undefined) return Promise.resolve(resultado);
            return original.call(this, sql, ...resto);
        });
    }

    test('falha ao persistir a taxa (exceção ZERO): nada de venda, itens, pagamentos, estoque, taxa nem chave de idempotência', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const antes = await fotografia('ZERO');

        let falhou = false;
        interceptarConsulta((sql) => {
            if (!falhou && sql.includes('INSERT INTO taxas_venda')) {
                falhou = true;
                return new Error('falha simulada ao gravar a taxa');
            }
            return undefined;
        });

        const corpo = { pagamentos: [{ forma_pagamento: 'pix', valor: 1000 }] };
        const chave = { 'Idempotency-Key': `falha-grava-${SUFIXO}` };
        const res = await vender('ZERO', corpo, chave);

        expect(falhou).toBe(true);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ success: false, message: 'Erro interno do servidor' });
        expect(await fotografia('ZERO')).toEqual(antes);

        const retry = await vender('ZERO', corpo, chave);
        expect(retry.status).toBe(201); // a chave não ficou presa
        expect(await taxaDaVenda(retry.body.data.id)).toHaveLength(1);
    });

    test('falha de cálculo (percentual da exceção inválido): 500 genérico, nada fica gravado', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const antes = await fotografia('SEM');

        interceptarConsulta((sql) =>
            sql.includes('FROM condicoes_comerciais_empresa')
                ? { rows: [{ id: 1, tipo: 'percentual', percentual: 'abc' }], rowCount: 1 }
                : undefined);

        const res = await vender('SEM', { pagamentos: [{ forma_pagamento: 'pix', valor: 1000 }] });

        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/taxa|percentual|condic/i);
        jest.restoreAllMocks();
        expect(await fotografia('SEM')).toEqual(antes);
    });

    test('política do plano ausente: apurar bloqueia mesmo com exceção vigente (transação não confirmada)', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE politicas_taxa_plataforma SET ativo = false');
            await criarCondicao(empresas.COM.id, { percentual: 0, inicio: await dia(0) }, client);

            await expect(
                taxasPlataformaRepository.apurar({ venda_id: 1, empresa_id: empresas.COM.id, base: 100 }, client)
            ).rejects.toMatchObject({ statusCode: 500 });
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }

        const ativas = await db.query('SELECT count(*)::int AS n FROM politicas_taxa_plataforma WHERE ativo');
        expect(ativas.rows[0].n).toBeGreaterThanOrEqual(2);
    });

    test('plano comercial inativo: erro 500 em vez de cair no padrão em silêncio (transação não confirmada)', async () => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await criarPlanoEmpresa(empresas.ZERO.id, 'com_mensalidade', { inicio: await dia(-2) }, client);
            await client.query(`UPDATE planos_comerciais SET ativo = false WHERE codigo = 'com_mensalidade'`);

            await expect(taxasPlataformaRepository.resolverRegra(empresas.ZERO.id, client)).rejects.toMatchObject({ statusCode: 500 });
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }

        const ativo = await db.query(`SELECT ativo FROM planos_comerciais WHERE codigo = 'com_mensalidade'`);
        expect(ativo.rows[0].ativo).toBe(true);
    });
});

describe('planos da migration 077 resolvem o percentual certo para a empresa', () => {
    // Empresa temporária dentro de uma transação que sempre dá ROLLBACK: nada persiste.
    test.each([
        ['cortesia', '0.5000'],
        ['basico', '0.5000'],
        ['padrao', '0.4000'],
        ['pro', '0.3000']
    ])('empresa no plano %s paga %s%% (pontos percentuais) sobre o Pix', async (codigo, esperado) => {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const emp = await client.query(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste Plano ${codigo} ${SUFIXO}`]);
            await criarPlanoEmpresa(emp.rows[0].id, codigo, { inicio: '2026-10-30' }, client);

            const regra = await taxasPlataformaRepository.resolverRegra(emp.rows[0].id, client);
            expect(regra).toMatchObject({ origem: 'plano_padrao', percentual: esperado });

            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    });
});
