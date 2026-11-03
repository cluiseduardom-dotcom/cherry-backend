#!/usr/bin/env node
'use strict';

// Operadores do Painel GiroNex (uso manual, em terminal seguro, com acesso ao banco).
// Não há tela para isso de propósito: criar operador ou zerar o 2FA é a ação mais sensível da plataforma.
//
//   DATABASE_URL=... node scripts/painel-operador.js criar "Nome Completo" email@dominio
//   DATABASE_URL=... node scripts/painel-operador.js resetar-2fa email@dominio   (celular perdido)
//   DATABASE_URL=... node scripts/painel-operador.js bloquear email@dominio
//
// - criar: gera uma senha TEMPORÁRIA aleatória, mostrada UMA vez; no primeiro acesso o painel exige trocar a
//   senha e configurar o app autenticador.
// - resetar-2fa e bloquear derrubam as sessões abertas (token_version) e vão para a trilha do painel.
// - Fora de localhost, pede para digitar o host do banco (evita mexer em produção por engano).

const readline = require('node:readline');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const { senhaTemporaria } = require('../src/services/painelEmpresasService');

function perguntar(texto) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r.trim()); }));
}

async function main() {
    const [comando, ...args] = process.argv.slice(2);
    const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
    if (!url) throw new Error('Defina DATABASE_URL (ou DATABASE_MIGRATION_URL).');

    const host = new URL(url).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
        const conf = await perguntar(`Banco em ${host}. Digite o host para confirmar: `);
        if (conf !== host) throw new Error('Confirmação não confere. Nada foi feito.');
    }

    const db = new Pool({ connectionString: url, ssl: host.includes('neon.tech') ? { rejectUnauthorized: true } : undefined });

    try {
        if (comando === 'criar') {
            const [nome, emailBruto] = args;
            const email = String(emailBruto ?? '').trim().toLowerCase();
            if (!nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Uso: criar "Nome Completo" email@dominio');

            const senha = senhaTemporaria(16);
            const { rows } = await db.query(
                `INSERT INTO plataforma_operadores (nome, email, senha, senha_temporaria) VALUES ($1, $2, $3, true) RETURNING id`,
                [nome, email, await bcrypt.hash(senha, 12)]
            );
            await db.query(`INSERT INTO plataforma_eventos (operador_id, acao, detalhe) VALUES ($1, 'operador_criado', $2)`, [rows[0].id, JSON.stringify({ via: 'script' })]);
            console.log(`Operador #${rows[0].id} criado: ${email}`);
            console.log(`Senha temporária (mostrada só agora): ${senha}`);
            console.log('No primeiro acesso: trocar a senha e configurar o app autenticador.');
            return;
        }

        if (comando === 'resetar-2fa' || comando === 'bloquear') {
            const email = String(args[0] ?? '').trim().toLowerCase();
            const set = comando === 'bloquear' ? 'ativo = false' : 'totp_ativo = false, totp_segredo = NULL, totp_ultimo_passo = NULL';
            const { rows } = await db.query(
                `UPDATE plataforma_operadores SET ${set}, token_version = token_version + 1 WHERE email = $1 RETURNING id`,
                [email]
            );
            if (!rows[0]) throw new Error(`Operador ${email} não encontrado.`);
            await db.query(`INSERT INTO plataforma_eventos (operador_id, acao, detalhe) VALUES ($1, $2, $3)`, [rows[0].id, comando === 'bloquear' ? 'operador_bloqueado' : '2fa_resetado', JSON.stringify({ via: 'script' })]);
            console.log(comando === 'bloquear' ? `Operador ${email} bloqueado.` : `2FA de ${email} zerado: configure de novo no próximo acesso.`);
            return;
        }

        throw new Error('Comandos: criar "Nome" email | resetar-2fa email | bloquear email');
    } finally {
        await db.end();
    }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
