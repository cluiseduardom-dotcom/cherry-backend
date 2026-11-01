#!/usr/bin/env node
'use strict';

// Provisionamento de empresa (tenant) pelo operador da plataforma.
//
// Chama POST /onboarding do backend indicado. NÃO acessa banco: tudo passa pela API, com a mesma
// validação e a mesma transação do serviço. Pensado para uso manual, em terminal seguro.
//
//   PROVISION_API_URL=https://cherry-backend-staging.onrender.com \
//   ONBOARDING_SECRET=... \
//   node scripts/provisionar-tenant.js [--dry-run]
//
// Regras de segurança:
//  - o segredo e a URL vêm SÓ de variáveis de ambiente; nada de argumento de linha de comando
//    (que ficaria no histórico do shell);
//  - a senha do admin é lida sem eco (ou da entrada padrão, quando não há terminal) e nunca é impressa;
//  - o token devolvido pela API é descartado: o admin entra pela tela de login;
//  - fora de localhost, é preciso digitar o endereço do servidor para confirmar (evita criar em produção
//    por engano);
//  - --dry-run valida os dados e mostra o que seria enviado, sem enviar nada.

const readline = require('node:readline');
const { Writable } = require('node:stream');
const { onboardingSchema } = require('../src/validations/onboardingValidation');

const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '[::1]'];

function lerAmbiente(env = process.env) {
    const bruto = (env.PROVISION_API_URL || '').trim();
    const segredo = (env.ONBOARDING_SECRET || '').trim();

    if (!bruto) {
        throw new Error('Defina PROVISION_API_URL (ex.: https://cherry-backend-staging.onrender.com).');
    }

    let url;
    try {
        url = new URL(bruto);
    } catch {
        throw new Error('PROVISION_API_URL não é uma URL válida.');
    }

    const local = HOSTS_LOCAIS.includes(url.hostname);

    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
        throw new Error('PROVISION_API_URL deve usar https (http só em localhost).');
    }

    if (!segredo && !local) {
        throw new Error('Defina ONBOARDING_SECRET (só em localhost o segredo é dispensado).');
    }

    return { base: url.origin, host: url.host, local, segredo };
}

// Valida com o MESMO schema do backend. Devolve { corpo } ou lança com a primeira mensagem de erro.
function validarDados(dados) {
    const entrada = { ...dados };
    if (!entrada.cnpj) delete entrada.cnpj;

    const resultado = onboardingSchema.safeParse(entrada);

    if (!resultado.success) {
        throw new Error(resultado.error.issues[0].message);
    }

    return resultado.data;
}

// Texto da confirmação: nunca inclui a senha.
function resumo(corpo, destino) {
    return [
        `Servidor:       ${destino.base}${destino.local ? ' (local)' : ''}`,
        `Empresa:        ${corpo.empresa_nome}`,
        `CNPJ/CPF:       ${corpo.cnpj || '(não informado)'}`,
        `Admin:          ${corpo.nome_admin} <${corpo.email_admin}>`,
        'Senha:          (oculta)',
    ].join('\n');
}

// Em servidor remoto, quem confirma digita o endereço (host) do servidor.
function confirmacaoValida(destino, digitado) {
    if (destino.local) return String(digitado).trim().toLowerCase() === 's';
    return String(digitado).trim().toLowerCase() === destino.host.toLowerCase();
}

function mensagemDeErro(status, corpo) {
    if (status === 401) return 'Não autorizado: o segredo informado não confere com o do servidor.';
    if (status === 503) return 'Provisionamento indisponível: ONBOARDING_SECRET não está configurado no servidor.';
    if (status === 409) return 'Conflito: já existe um administrador com esse e-mail (o e-mail é único em todo o sistema).';
    if (status === 429) return 'Limite de tentativas atingido. Aguarde e tente de novo.';
    const detalhe = corpo && (corpo.message || corpo.erro);
    return `Falha ${status}${detalhe ? `: ${detalhe}` : ''}`;
}

async function enviar(destino, corpo, fetchImpl = fetch) {
    const resposta = await fetchImpl(`${destino.base}/onboarding`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(destino.segredo ? { 'X-Onboarding-Secret': destino.segredo } : {}),
        },
        body: JSON.stringify(corpo),
    });

    let json = null;
    try {
        json = await resposta.json();
    } catch {
        // sem corpo JSON
    }

    if (!resposta.ok) {
        throw new Error(mensagemDeErro(resposta.status, json));
    }

    // Só o necessário; o token (json.data.token) é deliberadamente descartado.
    const dados = (json && json.data) || {};
    return { empresa: dados.empresa, usuario: dados.usuario };
}

// Perguntas: com terminal, a senha é lida sem eco; sem terminal, lê linhas da entrada padrão.
function criarPerguntador(entrada = process.stdin, saida = process.stdout) {
    const tty = Boolean(entrada.isTTY);
    let mudo = false;

    const saidaFiltrada = new Writable({
        write(chunk, _enc, cb) {
            if (!mudo) saida.write(chunk);
            cb();
        },
    });

    const rl = readline.createInterface({ input: entrada, output: saidaFiltrada, terminal: tty });
    const fila = [];
    const esperando = [];
    let fim = false;

    if (!tty) {
        rl.on('line', (linha) => {
            if (esperando.length) esperando.shift()(linha);
            else fila.push(linha);
        });
        rl.on('close', () => {
            fim = true;
            while (esperando.length) esperando.shift()('');
        });
    }

    function perguntar(texto, { oculto = false } = {}) {
        saida.write(texto);

        if (!tty) {
            return new Promise((resolve) => {
                if (fila.length) resolve(fila.shift());
                else if (fim) resolve('');
                else esperando.push(resolve);
            }).then((resposta) => {
                if (oculto) saida.write('\n');
                else saida.write(`${resposta}\n`);
                return resposta;
            });
        }

        return new Promise((resolve) => {
            mudo = oculto;
            rl.question('', (resposta) => {
                mudo = false;
                if (oculto) saida.write('\n');
                resolve(resposta);
            });
        });
    }

    return { perguntar, fechar: () => rl.close() };
}

async function coletarDados(perguntador) {
    const empresa_nome = await perguntador.perguntar('Nome da empresa: ');
    const cnpj = await perguntador.perguntar('CNPJ/CPF (opcional, Enter para pular): ');
    const nome_admin = await perguntador.perguntar('Nome do administrador: ');
    const email_admin = await perguntador.perguntar('E-mail do administrador: ');
    const senha_admin = await perguntador.perguntar('Senha inicial do administrador (não aparece): ', { oculto: true });
    const repetir = await perguntador.perguntar('Repita a senha: ', { oculto: true });

    if (senha_admin !== repetir) {
        throw new Error('As senhas não conferem.');
    }

    return { empresa_nome, cnpj, nome_admin, email_admin, senha_admin };
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const dryRun = argv.includes('--dry-run');
    const destino = lerAmbiente(env);
    const perguntador = criarPerguntador();

    try {
        const corpo = validarDados(await coletarDados(perguntador));

        console.log(`\n${resumo(corpo, destino)}\n`);

        if (dryRun) {
            console.log('--dry-run: dados válidos. Nada foi enviado.');
            return 0;
        }

        const pergunta = destino.local
            ? 'Criar esta empresa? (s/N): '
            : `Servidor REMOTO. Para confirmar, digite o endereço do servidor (${destino.host}): `;

        if (!confirmacaoValida(destino, await perguntador.perguntar(pergunta))) {
            console.log('Cancelado. Nada foi enviado.');
            return 1;
        }

        const { empresa, usuario } = await enviar(destino, corpo);

        console.log(`\nEmpresa criada: #${empresa?.id} ${empresa?.nome}`);
        console.log(`Administrador:  #${usuario?.id} ${usuario?.email}`);
        console.log('\nPróximos passos:');
        console.log('  1. No painel da plataforma (Planos e condições), defina o tema e o endereço (slug) da empresa.');
        console.log('  2. Entregue o acesso ao administrador por um canal seguro e peça a troca da senha no primeiro login.');
        return 0;
    } finally {
        perguntador.fechar();
    }
}

module.exports = { lerAmbiente, validarDados, resumo, confirmacaoValida, mensagemDeErro, enviar, coletarDados, criarPerguntador, main };

if (require.main === module) {
    main().then(
        (codigo) => process.exit(codigo),
        (erro) => {
            console.error(`\nErro: ${erro.message}`);
            process.exit(1);
        }
    );
}
