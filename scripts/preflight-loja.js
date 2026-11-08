'use strict';

// Verificação de prontidão (go-live) da loja online. SOMENTE LEITURA: só executa SELECT, nunca grava, nunca imprime
// valor de variável secreta (só "definida" / "ausente"). Uso:
//   node scripts/preflight-loja.js <slug-da-empresa>
// Roda com as mesmas variáveis da API (DATABASE_URL etc.). Sai com código 1 se algum item BLOQUEANTE falhar.
require('dotenv').config({ quiet: true });

const db = require('../src/config/db');

const slug = (process.argv[2] || '').trim();
const resultados = [];

function registrar(nivel, item, detalhe) {
    resultados.push({ nivel, item, detalhe });
}
const ok = (item, detalhe = '') => registrar('OK', item, detalhe);
const falha = (item, detalhe) => registrar('FALHA', item, detalhe);
const aviso = (item, detalhe) => registrar('AVISO', item, detalhe);

function definida(nome) {
    return Boolean((process.env[nome] || '').trim());
}

function verificarVariaveis() {
    const obrigatorias = [
        ['DATABASE_URL', 'conexão com o banco'],
        ['JWT_SECRET', 'sessões'],
        ['LOJA_CORS_ORIGINS', 'a loja só consegue chamar a API se o endereço dela estiver aqui'],
        ['LOJA_PUBLIC_URL', 'retorno do pagamento por cartão'],
        ['TURNSTILE_SECRET_KEY', 'anti-robô; sem ela a API recusa pedidos em produção'],
        ['MP_APP_ID', 'Mercado Pago'],
        ['MP_CLIENT_SECRET', 'Mercado Pago'],
        ['MP_REDIRECT_URI', 'Mercado Pago'],
        ['MP_WEBHOOK_SECRET', 'assinatura do webhook; sem ela nenhum pagamento é confirmado'],
        ['MP_WEBHOOK_URL', 'onde o Mercado Pago avisa os pagamentos'],
        ['MP_TOKEN_ENC_KEY', 'cifra dos tokens do Mercado Pago'],
        ['R2_PUBLIC_BASE_URL', 'endereço público das fotos']
    ];
    for (const [nome, motivo] of obrigatorias) {
        if (definida(nome)) ok(`Variável ${nome}`, 'definida');
        else falha(`Variável ${nome}`, `ausente (${motivo})`);
    }
    if (definida('LOJA_PUBLIC_URL') && !/^https:\/\//i.test(process.env.LOJA_PUBLIC_URL.trim())) {
        falha('LOJA_PUBLIC_URL', 'precisa começar com https://');
    }
    if (definida('LOJA_CORS_ORIGINS') && process.env.LOJA_CORS_ORIGINS.includes('*')) {
        falha('LOJA_CORS_ORIGINS', 'não use curinga: liste o endereço exato da loja');
    }
    if (String(process.env.MP_SANDBOX).toLowerCase() === 'true') {
        aviso('MP_SANDBOX', 'ligado: pagamentos de teste, não é o que vale em produção');
    }
    if (process.env.NODE_ENV !== 'production') {
        aviso('NODE_ENV', `está "${process.env.NODE_ENV || '(vazio)'}", em produção deve ser "production"`);
    }
}

async function um(sql, params = []) {
    const { rows } = await db.query(sql, params);
    return rows[0] ?? null;
}

async function verificarBanco() {
    const mig = await um(`SELECT MAX(version) AS v FROM schema_migrations`);
    const versao = Number(mig?.v ?? 0);
    if (versao >= 98) ok('Migrations', `última aplicada: ${versao}`);
    else falha('Migrations', `última aplicada: ${versao}; a loja precisa de 095 a 098`);

    if (!slug) {
        falha('Empresa', 'informe o slug: node scripts/preflight-loja.js <slug>');
        return;
    }
    const empresa = await um(`SELECT id, status FROM empresas WHERE slug = $1`, [slug]);
    if (!empresa) {
        falha('Empresa', `nenhuma empresa com o slug "${slug}"`);
        return;
    }
    if (empresa.status === 'ativa') ok('Empresa', 'ativa');
    else falha('Empresa', `status "${empresa.status}"`);
    const id = empresa.id;

    const ligada = await um(
        `SELECT 1 AS ok FROM empresa_funcionalidades
          WHERE empresa_id = $1 AND funcionalidade = 'loja_online' AND ligada = true
            AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)`, [id]);
    if (ligada) ok('Funcionalidade loja_online', 'ligada para a empresa');
    else falha('Funcionalidade loja_online', 'desligada (ligue no Painel; o plano pode incluí-la, a API pública confirma)');

    const canal = await um(`SELECT id FROM canais_venda WHERE empresa_id = $1 AND nome = 'online' AND ativo = true`, [id]);
    if (canal) ok('Canal de venda "online"', 'existe e está ativo');
    else falha('Canal de venda "online"', 'não existe: sem ele nenhum preço é publicado');

    const mp = await um(`SELECT ativo FROM empresa_mercadopago WHERE empresa_id = $1`, [id]);
    if (mp?.ativo) ok('Mercado Pago da empresa', 'conectado');
    else falha('Mercado Pago da empresa', 'não conectado (conectar pelo ERP)');

    const locais = await um(
        `SELECT COUNT(*) FILTER (WHERE tipo = 'central')::int AS central,
                COUNT(*) FILTER (WHERE tipo = 'reserva')::int AS reserva
           FROM locais_estoque WHERE empresa_id = $1 AND ativo = true`, [id]);
    if (locais?.central >= 1) ok('Estoque Central', 'presente');
    else falha('Estoque Central', 'local Central não existe');
    // A Reserva online é criada sozinha no primeiro pedido; não é bloqueante.
    if (!locais?.reserva) aviso('Reserva online', 'ainda não existe; é criada no primeiro pedido (esperado antes do primeiro pagamento)');

    const vis = await um(
        `SELECT COUNT(*)::int AS marcados,
                COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM precos_produto pp JOIN canais_venda cv ON cv.id = pp.canal_id AND cv.empresa_id = pp.empresa_id
                     WHERE pp.produto_id = pl.produto_id AND pp.empresa_id = pl.empresa_id AND cv.nome = 'online' AND pp.preco_venda > 0
                )) AS com_preco
           FROM produtos_loja pl WHERE pl.empresa_id = $1 AND pl.visivel = true`, [id]);
    if (!vis || vis.marcados === 0) falha('Produtos visíveis', 'nenhum produto marcado como visível');
    else if (vis.com_preco === 0) falha('Produtos visíveis', `${vis.marcados} marcados, nenhum com preço no canal online`);
    else if (vis.com_preco < vis.marcados) aviso('Produtos visíveis', `${vis.marcados} marcados, ${vis.marcados - vis.com_preco} sem preço no canal online (não aparecem)`);
    else ok('Produtos visíveis', `${vis.marcados} com preço no canal online`);

    const fotos = await um(
        `SELECT COUNT(*)::int AS n FROM produtos_loja pl
          WHERE pl.empresa_id = $1 AND pl.visivel = true
            AND NOT EXISTS (SELECT 1 FROM produto_imagens i WHERE i.produto_id = pl.produto_id AND i.empresa_id = pl.empresa_id)`, [id]);
    if (fotos?.n > 0) aviso('Fotos', `${fotos.n} produto(s) visíveis sem foto`);

    const presos = await um(
        `SELECT COUNT(*)::int AS n FROM pedidos_loja WHERE empresa_id = $1 AND status = 'aguardando_pagamento' AND reserva_expira_em < NOW() - INTERVAL '10 minutes'`, [id]);
    if (presos?.n > 0) falha('Cron de reservas', `${presos.n} reserva(s) vencida(s) há mais de 10 min: o Cron Job do Render não está rodando`);
    else ok('Cron de reservas', 'nenhuma reserva vencida parada');
}

(async () => {
    try {
        verificarVariaveis();
        await verificarBanco();
    } catch (error) {
        falha('Execução', error.message);
    } finally {
        await db.end().catch(() => {});
    }
    for (const r of resultados) console.log(`[${r.nivel.padEnd(5)}] ${r.item}${r.detalhe ? ` — ${r.detalhe}` : ''}`);
    const falhas = resultados.filter((r) => r.nivel === 'FALHA').length;
    const avisos = resultados.filter((r) => r.nivel === 'AVISO').length;
    console.log(`\n${falhas} bloqueante(s), ${avisos} aviso(s).`);
    console.log('Não verificável por aqui: assinatura real do webhook (só o primeiro pagamento prova), Turnstile no navegador, frete.');
    process.exitCode = falhas ? 1 : 0;
})();
