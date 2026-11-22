#!/usr/bin/env node
'use strict';

// Demonstração: uma confeitaria de verdade dentro do sistema, para ver o PCP (receitas, produção, insumos pendentes, avisos)
// funcionando. Cria uma EMPRESA NOVA ("Doces da Ana (demo)"), sem tocar em nenhuma outra, usando a própria API: tudo passa pelas
// mesmas regras do sistema. Só para banco LOCAL/descartável.
//
//   1) banco local migrado:        npm run db:migrate
//   2) servidor em modo dev:       NODE_ENV=development npm start      (o /onboarding só abre sem segredo em dev/test)
//   3) este script (outro terminal): node scripts/demo/confeitaria.js
//   4) frontend:                   VITE_API_URL=http://localhost:3000 npm run dev   (no cherry-frontend)
//
// Variáveis: API_URL (padrão http://localhost:3000), DATABASE_URL (a mesma do servidor; usada só para ligar as funcionalidades
// da empresa demo e antedatar o prazo de uma ordem), DEMO_SENHA (padrão "Confeitaria#2026").
// Travas: recusa API ou banco que não sejam locais, a menos que DEMO_PERMITIR_REMOTO=sim (não faça isso em produção).

require('dotenv').config();
const db = require('../../src/config/db');

const API = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = 'ana@docesdaana.demo';
const SENHA = process.env.DEMO_SENHA || 'Confeitaria#2026';
const LOCAIS = ['localhost', '127.0.0.1', '[::1]', '::1'];

function exigirLocal() {
    if (process.env.DEMO_PERMITIR_REMOTO === 'sim') return;
    const hostApi = new URL(API).hostname;
    let hostBanco = 'localhost';
    try { hostBanco = new URL(process.env.DATABASE_URL || 'postgresql://localhost/x').hostname; } catch { /* formato fora do padrão: trata como não local */ hostBanco = '?'; }
    if (!LOCAIS.includes(hostApi) || !LOCAIS.includes(hostBanco)) {
        throw new Error(`Recusado: API (${hostApi}) ou banco (${hostBanco}) não é local. Esta demonstração é só para banco local/descartável.`);
    }
}

let token = null;

async function chamar(metodo, caminho, corpo, { semToken = false, aceitar = [] } = {}) {
    const res = await fetch(`${API}${caminho}`, {
        method: metodo,
        headers: { 'content-type': 'application/json', ...(token && !semToken ? { authorization: `Bearer ${token}` } : {}) },
        body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    const texto = await res.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
    if (!res.ok && !aceitar.includes(res.status)) {
        throw new Error(`${metodo} ${caminho} → ${res.status}: ${json?.message || json?.erro || texto.slice(0, 200)}`);
    }
    return { status: res.status, corpo: json, dados: json?.data ?? json };
}

const passo = (texto) => console.log(`\n▶ ${texto}`);
const ok = (texto) => console.log(`  ✓ ${texto}`);

async function main() {
    exigirLocal();

    passo('Empresa nova: "Doces da Ana (demo)" com o modelo de confeitaria');
    const criar = await chamar('POST', '/onboarding', { empresa_nome: 'Doces da Ana (demo)', nome_admin: 'Ana Confeiteira', email_admin: EMAIL, senha_admin: SENHA, modelo_nicho: 'confeitaria' }, { semToken: true, aceitar: [409, 400, 503] });
    if (criar.status === 503) throw new Error('O /onboarding está fechado: suba o servidor com NODE_ENV=development.');
    if (criar.status !== 201 && criar.status !== 200) {
        const login = await chamar('POST', '/auth/login', { email: EMAIL, senha: SENHA }, { semToken: true, aceitar: [400, 401, 403, 404] });
        if (login.status === 200) throw new Error(`A demonstração já existe neste banco (login ${EMAIL}). Para recomeçar, use um banco novo.`);
        throw new Error(`Não foi possível criar a empresa: ${criar.status} ${criar.corpo?.message || ''}`);
    }
    const empresaId = criar.dados?.empresa?.id ?? criar.dados?.usuario?.empresa_id;
    ok('empresa criada; categorias de confeitaria e padrão de SKU prontos (BOL, TOR, DOC... × tamanhos)');

    passo('Ligando as funcionalidades (como a GiroNex faria): PCP e Compras avançado');
    const { rows: [{ id }] } = await db.query('SELECT id FROM empresas WHERE nome = $1 ORDER BY id DESC LIMIT 1', ['Doces da Ana (demo)']);
    for (const f of ['pcp', 'compras_avancado']) {
        await db.query(
            `INSERT INTO empresa_funcionalidades (empresa_id, funcionalidade, ligada, justificativa, responsavel) VALUES ($1, $2, true, 'demonstração', 'demo')
             ON CONFLICT (empresa_id, funcionalidade) DO UPDATE SET ligada = true`,
            [empresaId ?? id, f]
        );
    }
    ok('pcp, compras_avancado');

    const login = await chamar('POST', '/auth/login', { email: EMAIL, senha: SENHA }, { semToken: true });
    token = login.dados.token || login.corpo.token;
    ok(`login como Ana (${EMAIL})`);

    passo('Fornecedores');
    const forn = {};
    for (const nome of ['Atacado Doce Mel', 'Distribuidora Boa Massa']) forn[nome] = (await chamar('POST', '/fornecedores', { nome })).dados.id;
    ok(Object.keys(forn).join(', '));

    passo('Insumos (em gramas, ml ou unidade; o custo é por grama/ml)');
    // [nome, unidade, custo por unidade-base, quantidade comprada, fornecedor]
    const INSUMOS = [
        ['Leite condensado', 'G', 0.019, 20000, 'Atacado Doce Mel'],
        ['Chocolate em pó 50%', 'G', 0.045, 6000, 'Atacado Doce Mel'],
        ['Chocolate meio amargo', 'G', 0.06, 4000, 'Atacado Doce Mel'],
        ['Manteiga', 'G', 0.045, 400, 'Distribuidora Boa Massa'],
        ['Farinha de trigo', 'G', 0.005, 10000, 'Distribuidora Boa Massa'],
        ['Açúcar', 'G', 0.0045, 8000, 'Distribuidora Boa Massa'],
        ['Creme de leite', 'G', 0.016, 4000, 'Atacado Doce Mel'],
        ['Biscoito maisena', 'G', 0.012, 3000, 'Distribuidora Boa Massa'],
        ['Cenoura', 'G', 0.006, 3000, 'Distribuidora Boa Massa'],
        ['Ovos', 'UN', 0.9, 60, 'Distribuidora Boa Massa']
    ];
    const insumo = {};
    for (const [nome, unidade, custo] of INSUMOS) insumo[nome] = (await chamar('POST', '/produtos', { nome, tipo: 'insumo', unidade, custo })).dados.id;
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    for (const f of Object.keys(forn)) {
        const itens = INSUMOS.filter((i) => i[4] === f).map(([nome, , custo, qtd]) => ({ produto_id: insumo[nome], quantidade: qtd, custo_unitario: custo }));
        await chamar('POST', '/compras', { fornecedor_id: forn[f], data_compra: hoje, forma_pagamento: 'a_vista', itens });
    }
    ok(`${INSUMOS.length} insumos com estoque (a manteiga é pouca de propósito: 400 g)`);

    passo('Produtos da vitrine, com SKU pelas categorias do modelo');
    const categorias = (await chamar('GET', '/categorias')).dados;
    const lista = Array.isArray(categorias) ? categorias : categorias.items || [];
    const cat = (nivel, codigo) => lista.find((c) => c.nivel === nivel && c.codigo === codigo)?.id;
    // [nome, tipo, tamanho, preço, rendimento da receita, receita: [[insumo, quantidade por receita]]]
    const PRODUTOS = [
        ['Brigadeiro gourmet', 'DOC', 'UNI', 3.5, 40, [['Leite condensado', 790], ['Chocolate em pó 50%', 200], ['Manteiga', 40]]],
        ['Bolo de pote de cenoura', 'BOL', 'P', 12, 10, [['Farinha de trigo', 300], ['Açúcar', 250], ['Ovos', 4], ['Cenoura', 300], ['Chocolate meio amargo', 200]]],
        ['Torta de limão (inteira)', 'TOR', 'G', 78, 1, [['Leite condensado', 395], ['Creme de leite', 300], ['Biscoito maisena', 200], ['Manteiga', 80]]],
        ['Brownie', 'DOC', 'UNI', 9, 12, [['Chocolate meio amargo', 200], ['Manteiga', 150], ['Açúcar', 200], ['Ovos', 3], ['Farinha de trigo', 100]]]
    ];
    const prod = {};
    for (const [nome, tipo, tam, preco, rendimento, receita] of PRODUTOS) {
        const p = (await chamar('POST', '/produtos', { nome, custo: 0.01 })).dados;
        prod[nome] = p.id;
        if (cat(1, tipo) && cat(2, tam)) await chamar('PATCH', `/produtos/${p.id}/categoria`, { categoria_ids: [cat(1, tipo), cat(2, tam)] }, { aceitar: [400, 409] });
        await chamar('POST', `/produtos/${p.id}/ficha-tecnica`, { rendimento, itens: receita.map(([i, q]) => ({ insumo_produto_id: insumo[i], quantidade_necessaria: q })) });
        const canais = (await chamar('GET', '/canais-venda')).dados;
        const canal = (Array.isArray(canais) ? canais : canais.items || []).find((c) => c.nome === 'loja_fisica');
        await chamar('PUT', `/produtos/${p.id}/precos/${canal.id}`, { preco_venda: preco }, { aceitar: [409] });
    }
    ok(`${PRODUTOS.length} produtos com receita (ficha técnica com rendimento) e preço`);

    passo('Venda por peso: granola da casa a R$ 48,00 o kg');
    const granola = (await chamar('POST', '/produtos', { nome: 'Granola da casa', custo: 0.025, unidade: 'G', preco_base_quantidade: 1000 })).dados;
    await chamar('POST', '/compras', { fornecedor_id: forn['Atacado Doce Mel'], data_compra: hoje, forma_pagamento: 'a_vista', itens: [{ produto_id: granola.id, quantidade: 3000, custo_unitario: 0.025 }] });
    const canais = (await chamar('GET', '/canais-venda')).dados;
    const canalFisico = (Array.isArray(canais) ? canais : canais.items || []).find((c) => c.nome === 'loja_fisica');
    await chamar('PUT', `/produtos/${granola.id}/precos/${canalFisico.id}`, { preco_venda: 48 }, { aceitar: [409] });
    ok('granola em gramas (preço por kg), 3 kg em estoque');

    passo('Produção: as ordens');
    const ordem = async (nome, quantidade, extra = {}) => (await chamar('POST', '/producoes/ordens', { produto_id: prod[nome], quantidade_planejada: quantidade, ...extra })).dados.id;
    const iniciar = (id) => chamar('PATCH', `/producoes/ordens/${id}/iniciar`, {});
    const concluir = (id, produzida, perdida = 0) => chamar('PATCH', `/producoes/ordens/${id}/concluir`, { quantidade_produzida: produzida, quantidade_perdida: perdida });
    const dias = (n) => { const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

    const brig = await ordem('Brigadeiro gourmet', 200, { prazo: dias(0), observacao: 'Encomenda da festa' });
    await iniciar(brig); await concluir(brig, 196, 4);
    ok('#1 Brigadeiro 200 un.: concluída (196 boas, 4 perdidas)');

    const torta = await ordem('Torta de limão (inteira)', 8, { prazo: dias(0) });
    await iniciar(torta); await concluir(torta, 8);
    ok('#2 Torta de limão 8 un.: concluída SEM manteiga suficiente → a baixa fica pendente (regra: produzir mesmo assim)');

    await ordem('Bolo de pote de cenoura', 30, { prazo: dias(3), observacao: 'Pedido de sábado' });
    ok('#3 Bolo de pote 30 un.: planejada, prazo em 3 dias');

    const atrasada = await ordem('Brownie', 24, { prazo: dias(1) });
    await db.query(`UPDATE ordens_producao SET prazo = $1 WHERE id = $2`, [dias(-2), atrasada]);
    ok('#4 Brownie 24 un.: planejada, prazo VENCIDO há 2 dias (vai aparecer nos Avisos)');

    passo('Vendas no caixa');
    const vender = (itens, forma, valor) => chamar('POST', '/vendas', { itens, pagamentos: [{ forma_pagamento: forma, valor }] });
    await vender([{ produto_id: prod['Brigadeiro gourmet'], quantidade: 30 }], 'dinheiro', 105);
    await vender([{ produto_id: prod['Torta de limão (inteira)'], quantidade: 2 }], 'pix', 156);
    await vender([{ produto_id: granola.id, quantidade: 350 }], 'pix', 16.8);
    await vender([{ produto_id: prod['Brigadeiro gourmet'], quantidade: 12 }, { produto_id: granola.id, quantidade: 500 }], 'debito', 66);
    ok('4 vendas (inclui granola por peso: 350 g = R$ 16,80)');

    console.log(`\n✅ Pronto. Entre no sistema com:\n   e-mail: ${EMAIL}\n   senha:  ${SENHA}\n\n   Veja: Produção (ordens, receitas, insumo pendente), Avisos (sino), Estoque de insumos, Venda (granola por peso), Compras > Cotações.\n`);
}

main().then(() => db.end()).catch(async (erro) => {
    console.error(`\n✖ ${erro.message}`);
    await db.end().catch(() => {});
    process.exit(1);
});
