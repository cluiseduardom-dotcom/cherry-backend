// Integração de verdade (Postgres de testes): anonimização LGPD. Prova: simulação não grava; executar troca só o dado
// pessoal e preserva valores e trilha; idempotência; isolamento entre empresas; recusas; prazos de retenção; e que nada
// de dado pessoal aparece no resultado devolvido.
const crypto = require('node:crypto');
const db = require('../src/config/db');
const lgpd = require('../src/services/lgpdService');
const { ANONIMIZADO } = require('../src/constants/lgpd');
const { criarRegistroDeEmpresas } = require('./helpers/limpezaEmpresasTeste');

const registro = criarRegistroDeEmpresas(db);
const sufixo = crypto.randomBytes(3).toString('hex');
const A = {};
const B = {};
const um = async (sql, params) => (await db.query(sql, params)).rows[0].id;
const linha = async (sql, params) => (await db.query(sql, params)).rows[0];
let n = 0;
const cpfs = new Map(); // CPF é único no banco: cada colaborador de teste recebe o seu

async function criarEmpresa(E, nome) {
    E.id = registro.registrar(await um(`INSERT INTO empresas (nome, status) VALUES ($1, 'ativa') RETURNING id`, [`Teste LGPD ${nome} ${sufixo}`]));
    E.admin = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES ($1, 'Admin', $2, 'x', 'admin') RETURNING id`, [E.id, `adm-${E.id}-${sufixo}@teste.local`]);
}

async function pedido(E, { status = 'pago', pagoHa = '1 day', encerradoHa = null, combinada = true, nome = 'Maria Comprou', email = 'maria@teste.local', tel = '11912345678' } = {}) {
    const codigo = crypto.randomUUID();
    const encerrado = ['cancelado', 'expirado'].includes(status);
    await db.query(
        `INSERT INTO pedidos_loja (codigo, empresa_id, status, cliente_nome, cliente_email, cliente_telefone, chave_idempotencia, hash_requisicao, subtotal, total,
                reserva_expira_em, pago_em, encerrado_em, motivo_encerramento, entrega_combinada_em, entrega_combinada_por)
         VALUES ($1, $2, $3::text, $4, $5, $6, $7, $8, 80, 80, NOW(),
                 CASE WHEN $3::text = 'pago' THEN NOW() - $9::interval END,
                 CASE WHEN $10 THEN NOW() - $11::interval END, CASE WHEN $10 THEN 'teste' END,
                 CASE WHEN $12 THEN NOW() END, CASE WHEN $12 THEN $13::int END)`,
        [codigo, E.id, status, nome, email, tel, `chave-${sufixo}-${++n}`, 'a'.repeat(64), pagoHa, encerrado, encerradoHa ?? '1 day', status === 'pago' && combinada, E.admin]
    );

    return codigo;
}

async function colaborador(E, { ativo = false, bloqueadoHa = null, comDados = true, comFoto = true } = {}) {
    const id = await um(`INSERT INTO usuarios (empresa_id, nome, email, senha, papel, ativo) VALUES ($1, 'Colaboradora Teste', $2, 'x', 'vendedor', $3) RETURNING id`, [E.id, `col-${++n}-${sufixo}@teste.local`, ativo]);
    if (comDados) {
        const cpf = String(70000000000 + Date.now() % 1e8 * 100 + n).slice(0, 11);
        cpfs.set(id, cpf);
        await db.query(`INSERT INTO usuarios_dados (usuario_id, empresa_id, telefone, cpf, data_nascimento, cep, logradouro, observacoes, atualizado_por) VALUES ($1, $2, '11987654321', $4, '1990-01-01', '01001000', 'Rua Teste', 'obs', $3)`, [id, E.id, E.admin, cpf]);
    }
    if (comFoto) {
        await db.query(`INSERT INTO usuarios_fotos (usuario_id, empresa_id, chave, content_type, tamanho_bytes, atualizado_por) VALUES ($1, $2, $3, 'image/png', 10, $4)`, [id, E.id, `${E.id}/usuarios/${id}.png`, E.admin]);
    }
    if (bloqueadoHa) {
        await db.query(`INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo, criado_em) VALUES ($1, 'bloquear', $2, 'vendedor', $3, 'saiu da loja', NOW() - $4::interval)`, [E.id, id, E.admin, bloqueadoHa]);
    }

    return id;
}

beforeAll(async () => {
    await criarEmpresa(A, 'A');
    await criarEmpresa(B, 'B');
});

afterAll(async () => {
    try { await registro.limpar(); } finally { await db.end(); }
});

describe('pedido da loja (pedido do titular)', () => {
    test('simulação não grava; executar troca só o dado pessoal, mantém valores e registra o evento', async () => {
        const codigo = await pedido(A);

        const sim = await lgpd.anonimizarPedidoLoja({ empresa_id: A.id, codigo });
        expect(sim.resultado).toBe('seria_anonimizado');
        expect((await linha('SELECT cliente_nome FROM pedidos_loja WHERE codigo = $1', [codigo])).cliente_nome).toBe('Maria Comprou');

        const r = await lgpd.anonimizarPedidoLoja({ empresa_id: A.id, codigo, executar: true, motivo: 'Pedido do titular' });
        const p = await linha('SELECT * FROM pedidos_loja WHERE codigo = $1', [codigo]);

        expect(r.resultado).toBe('anonimizado');
        expect([p.cliente_nome, p.cliente_email, p.cliente_telefone]).toEqual([ANONIMIZADO.NOME, ANONIMIZADO.EMAIL, null]);
        expect([Number(p.total), p.status]).toEqual([80, 'pago']);
        const ev = await linha(`SELECT tipo, detalhes FROM pedidos_loja_eventos WHERE pedido_id = $1 AND tipo = 'dados_anonimizados'`, [p.id]);
        expect(ev.detalhes.motivo).toBe('Pedido do titular');
        expect(JSON.stringify(r)).not.toMatch(/Maria|teste\.local|1191234/);
    });

    test('idempotente: repetir não faz nada nem duplica o evento', async () => {
        const codigo = await pedido(A);
        await lgpd.anonimizarPedidoLoja({ empresa_id: A.id, codigo, executar: true, motivo: 'Pedido do titular' });
        const r = await lgpd.anonimizarPedidoLoja({ empresa_id: A.id, codigo, executar: true, motivo: 'Pedido do titular' });
        const { rows } = await db.query(`SELECT 1 FROM pedidos_loja_eventos e JOIN pedidos_loja p ON p.id = e.pedido_id WHERE p.codigo = $1 AND e.tipo = 'dados_anonimizados'`, [codigo]);

        expect(r.resultado).toBe('ja_anonimizado');
        expect(rows).toHaveLength(1);
    });

    test('outra empresa não alcança o pedido (isolamento)', async () => {
        const codigo = await pedido(A);

        expect((await lgpd.anonimizarPedidoLoja({ empresa_id: B.id, codigo, executar: true, motivo: 'tentativa' })).resultado).toBe('nao_encontrado');
        expect((await linha('SELECT cliente_nome FROM pedidos_loja WHERE codigo = $1', [codigo])).cliente_nome).toBe('Maria Comprou');
    });

    test('recusa pedido aguardando pagamento e pedido pago com entrega ainda não combinada', async () => {
        const aguardando = await pedido(A, { status: 'aguardando_pagamento' });
        const semEntrega = await pedido(A, { combinada: false });

        expect((await lgpd.anonimizarPedidoLoja({ empresa_id: A.id, codigo: aguardando, executar: true, motivo: 'x titular' })).resultado).toBe('recusado');
        expect((await lgpd.anonimizarPedidoLoja({ empresa_id: A.id, codigo: semEntrega, executar: true, motivo: 'x titular' })).resultado).toBe('recusado');
    });

    test('código de pedido fora do formato é recusado com mensagem clara', async () => {
        await expect(lgpd.anonimizarPedidoLoja({ empresa_id: A.id, codigo: 'x' })).rejects.toThrow(/Código do pedido inválido/);
    });

    test('executar exige o motivo', async () => {
        await expect(lgpd.anonimizarPedidoLoja({ empresa_id: A.id, codigo: await pedido(A), executar: true })).rejects.toThrow(/motivo/i);
    });
});

describe('retenção', () => {
    test('anonimiza só o que passou do prazo (pago > 5 anos; não pago > 90 dias) e devolve apenas contagens', async () => {
        const E = {}; await criarEmpresa(E, 'Ret');
        const velhoPago = await pedido(E, { pagoHa: '6 years', nome: 'Velho Pago' });
        const novoPago = await pedido(E, { pagoHa: '1 year', nome: 'Novo Pago' });
        const velhoExpirado = await pedido(E, { status: 'expirado', encerradoHa: '100 days', nome: 'Velho Expirado' });
        const novoExpirado = await pedido(E, { status: 'expirado', encerradoHa: '10 days', nome: 'Novo Expirado' });

        const sim = await lgpd.aplicarRetencao({ empresa_id: E.id });
        expect(sim.pedidos).toEqual({ vencidos: 2, anonimizados: 0, recusados: 0 });

        const r = await lgpd.aplicarRetencao({ empresa_id: E.id, executar: true, executado_por: E.admin });
        const nome = async (c) => (await linha('SELECT cliente_nome FROM pedidos_loja WHERE codigo = $1', [c])).cliente_nome;

        expect(r.pedidos).toEqual({ vencidos: 2, anonimizados: 2, recusados: 0 });
        expect([await nome(velhoPago), await nome(velhoExpirado)]).toEqual([ANONIMIZADO.NOME, ANONIMIZADO.NOME]);
        expect([await nome(novoPago), await nome(novoExpirado)]).toEqual(['Novo Pago', 'Novo Expirado']);
        expect(JSON.stringify(r)).not.toMatch(/Velho|Novo/);
    });

    test('colaborador bloqueado há mais de 5 anos entra; bloqueado recente e ativo não', async () => {
        const E = {}; await criarEmpresa(E, 'RetCol');
        const velho = await colaborador(E, { bloqueadoHa: '6 years' });
        const recente = await colaborador(E, { bloqueadoHa: '1 year' });
        const ativo = await colaborador(E, { ativo: true });

        const r = await lgpd.aplicarRetencao({ empresa_id: E.id, executar: true, executado_por: E.admin });
        const cpf = async (id) => (await linha('SELECT cpf FROM usuarios_dados WHERE usuario_id = $1', [id])).cpf;

        expect(r.colaboradores).toEqual({ vencidos: 1, anonimizados: 1, recusados: 0 });
        expect(await cpf(velho)).toBeNull();
        expect(await cpf(recente)).toBe(cpfs.get(recente));
        expect(await cpf(ativo)).toBe(cpfs.get(ativo));
    });
});

describe('colaborador (dados cadastrais e foto)', () => {
    test('bloqueado: limpa dados e foto, preserva nome/e-mail da trilha e registra o evento; repetir é idempotente', async () => {
        const id = await colaborador(A, { bloqueadoHa: '1 day' });

        const sim = await lgpd.anonimizarColaborador({ empresa_id: A.id, usuario_id: id });
        expect(sim.resultado).toBe('seria_anonimizado');
        expect((await linha('SELECT cpf FROM usuarios_dados WHERE usuario_id = $1', [id])).cpf).toBe(cpfs.get(id));

        const r = await lgpd.anonimizarColaborador({ empresa_id: A.id, usuario_id: id, executar: true, executado_por: A.admin, motivo: 'Pedido do titular' });
        const d = await linha('SELECT * FROM usuarios_dados WHERE usuario_id = $1', [id]);

        expect(r.resultado).toBe('anonimizado');
        expect([d.cpf, d.telefone, d.data_nascimento, d.cep, d.logradouro, d.observacoes]).toEqual([null, null, null, null, null, null]);
        expect((await db.query('SELECT 1 FROM usuarios_fotos WHERE usuario_id = $1', [id])).rows).toHaveLength(0);
        expect((await linha('SELECT nome FROM usuarios WHERE id = $1', [id])).nome).toBe('Colaboradora Teste');
        expect((await linha(`SELECT campos FROM usuarios_eventos WHERE alvo_usuario_id = $1 AND acao = 'editar'`, [id])).campos).toEqual(['dados_pessoais_lgpd']);
        expect(JSON.stringify(r)).not.toMatch(/11987654321|chave|png/);
        expect(JSON.stringify(r)).not.toContain(cpfs.get(id));
        expect((await lgpd.anonimizarColaborador({ empresa_id: A.id, usuario_id: id, executar: true, executado_por: A.admin, motivo: 'Pedido do titular' })).resultado).toBe('ja_anonimizado');
    });

    test('recusa colaborador ativo; outra empresa não alcança; executar exige executado_por e motivo', async () => {
        const ativo = await colaborador(A, { ativo: true });
        const bloqueado = await colaborador(A, { bloqueadoHa: '1 day' });

        expect((await lgpd.anonimizarColaborador({ empresa_id: A.id, usuario_id: ativo, executar: true, executado_por: A.admin, motivo: 'Pedido do titular' })).resultado).toBe('recusado');
        expect((await lgpd.anonimizarColaborador({ empresa_id: B.id, usuario_id: bloqueado, executar: true, executado_por: B.admin, motivo: 'tentativa' })).resultado).toBe('nao_encontrado');
        await expect(lgpd.anonimizarColaborador({ empresa_id: A.id, usuario_id: bloqueado, executar: true, motivo: 'Pedido do titular' })).rejects.toThrow(/executando/);
        await expect(lgpd.anonimizarColaborador({ empresa_id: A.id, usuario_id: bloqueado, executar: true, executado_por: A.admin })).rejects.toThrow(/motivo/i);
        expect((await linha('SELECT cpf FROM usuarios_dados WHERE usuario_id = $1', [bloqueado])).cpf).toBe(cpfs.get(bloqueado));
    });
});

describe('simulação em todas as empresas (rotina mensal)', () => {
    test('conta o que venceu em cada empresa sem gravar nada e sem dado pessoal', async () => {
        const E = {}; await criarEmpresa(E, 'Todas');
        const velho = await pedido(E, { pagoHa: '6 years', nome: 'Pessoa Vencida' });

        const r = await lgpd.simularRetencaoTodasEmpresas();
        const minha = r.por_empresa.find((e) => e.empresa_id === E.id);

        expect(minha).toEqual({ empresa_id: E.id, pedidos_vencidos: 1, colaboradores_vencidos: 0 });
        expect(r.total.pedidos_vencidos).toBeGreaterThanOrEqual(1);
        expect((await linha('SELECT cliente_nome FROM pedidos_loja WHERE codigo = $1', [velho])).cliente_nome).toBe('Pessoa Vencida');
        expect(JSON.stringify(r)).not.toMatch(/Pessoa Vencida|teste\.local/);
    });
});
