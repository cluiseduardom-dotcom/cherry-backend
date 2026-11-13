'use strict';

// Anonimização de dados pessoais (LGPD). SIMULAÇÃO por padrão: só com --executar grava alguma coisa.
// Nunca imprime dado pessoal (só ids, códigos e contagens). Histórico financeiro e trilha NÃO são apagados.
//
//   Pedido do titular (comprador da loja online):
//     node scripts/lgpd-anonimizar.js --empresa 1 --pedido-loja <codigo-do-pedido> --motivo "Pedido do titular em 13/11/2026" [--executar]
//   Colaborador bloqueado (dados cadastrais e foto):
//     node scripts/lgpd-anonimizar.js --empresa 1 --colaborador <id> --executado-por <id-do-admin> --motivo "..." [--executar]
//   Prazos de retenção vencidos (ver src/constants/lgpd.js e docs/LGPD.md):
//     node scripts/lgpd-anonimizar.js --empresa 1 --retencao --executado-por <id-do-admin> [--executar]
//   Conferência mensal (todas as lojas, SÓ simulação: conta o que venceu, não grava nada):
//     node scripts/lgpd-anonimizar.js --retencao --todas-empresas
//
// Variáveis: as mesmas do serviço da API (DATABASE_URL etc.). Anonimizar não apaga cópias de segurança já feitas.
require('dotenv').config({ quiet: true });

const db = require('../src/config/db');
const lgpdService = require('../src/services/lgpdService');

function lerArgs(argv) {
    const args = {};

    for (let i = 0; i < argv.length; i += 1) {
        if (!argv[i].startsWith('--')) continue;
        const chave = argv[i].slice(2);
        const proximo = argv[i + 1];
        if (proximo === undefined || proximo.startsWith('--')) args[chave] = true;
        else { args[chave] = proximo; i += 1; }
    }

    return args;
}

const inteiro = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

(async () => {
    const args = lerArgs(process.argv.slice(2));
    const empresa_id = inteiro(args.empresa);
    const executar = args.executar === true;
    const todas = args['todas-empresas'] === true;

    try {
        if (todas) {
            if (executar) throw new Error('--todas-empresas é só simulação: para aplicar, rode por empresa com --empresa <id> --executar.');
            if (args.retencao !== true) throw new Error('--todas-empresas vale só com --retencao.');
            console.log('MODO: SIMULAÇÃO em todas as empresas ativas (nada é gravado)');
            console.log(JSON.stringify(await lgpdService.simularRetencaoTodasEmpresas(), null, 2));
            return;
        }

        if (!empresa_id) throw new Error('Informe --empresa <id>.');

        console.log(executar ? 'MODO: EXECUTAR (grava no banco)' : 'MODO: SIMULAÇÃO (nada é gravado; use --executar para aplicar)');

        let resultado;
        if (typeof args['pedido-loja'] === 'string') {
            resultado = await lgpdService.anonimizarPedidoLoja({ empresa_id, codigo: args['pedido-loja'], executar, motivo: args.motivo });
        } else if (args.colaborador !== undefined) {
            const usuario_id = inteiro(args.colaborador);
            if (!usuario_id) throw new Error('Informe --colaborador <id>.');
            resultado = await lgpdService.anonimizarColaborador({ empresa_id, usuario_id, executar, executado_por: inteiro(args['executado-por']), motivo: args.motivo });
        } else if (args.retencao === true) {
            resultado = await lgpdService.aplicarRetencao({ empresa_id, executar, executado_por: inteiro(args['executado-por']) });
        } else {
            throw new Error('Escolha uma ação: --pedido-loja <codigo>, --colaborador <id> ou --retencao.');
        }

        console.log(JSON.stringify(resultado, null, 2));
    } catch (error) {
        console.error('Falha:', error.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
})();
