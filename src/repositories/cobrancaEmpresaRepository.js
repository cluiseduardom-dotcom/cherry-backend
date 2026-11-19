const db = require('../config/db');
const AppError = require('../errors/AppError');
const painelRepository = require('./painelRepository');
const { HOJE_SQL, situacaoSql, ateSql } = require('./cobrancaSituacaoSql');

// Teste grátis, pagamento manual, isenção e desligamento de cada empresa, operados SÓ pelo Painel GiroNex (a empresa-alvo
// vem da rota; responsável e operador vêm da sessão do painel, nunca do corpo). A situação é derivada das datas por
// cobrancaSituacaoSql.js, a mesma regra que a sessão usa para pôr a empresa em somente leitura.
//
// Transação ad hoc, como limiteUsuariosPainelRepository e plataformaComercialRepository: executarComLock sempre filtra
// por empresa_id, e `empresas` não tem essa coluna. O FOR UPDATE na linha da empresa serializa mudanças da mesma empresa.
// Cada mudança grava a trilha (plataforma_eventos) NA MESMA transação. Nada é apagado.

const DIAS_TESTE_PADRAO = 30;
const MAX_DIAS_PAGAMENTO_A_FRENTE = 400;

async function emTransacao(empresa_id, fn) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query('SELECT id FROM empresas WHERE id = $1 FOR UPDATE', [empresa_id]);
        if (!rows.length) throw new AppError('Empresa não encontrada', 404);

        const resultado = await fn(client);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

const hoje = async (client) => (await client.query(`SELECT ${HOJE_SQL}::text AS hoje`)).rows[0].hoje;

async function ler(client, empresa_id) {
    const { rows } = await client.query(
        `SELECT e.id AS empresa_id, e.nome AS empresa_nome, e.status AS empresa_status,
                COALESCE(${situacaoSql('c')}, 'sem_regra') AS situacao,
                ${ateSql('c')} AS ate,
                c.trial_inicio::text AS trial_inicio, c.trial_fim::text AS trial_fim, c.pago_ate::text AS pago_ate,
                COALESCE(c.isenta, false) AS isenta, c.justificativa, c.responsavel, c.atualizado_em
         FROM empresas e
         LEFT JOIN empresa_cobranca c ON c.empresa_id = e.id
         WHERE e.id = $1`,
        [empresa_id]
    );

    return rows[0] ?? null;
}

async function obter(empresa_id) {
    const situacao = await ler(db, empresa_id);

    if (!situacao) throw new AppError('Empresa não encontrada', 404);

    return situacao;
}

async function gravarEvento(client, { operador_id, ip, acao, empresa_id, antes, depois, justificativa, responsavel, extra = {} }) {
    await painelRepository.registrarEvento({
        operador_id,
        acao,
        alvo_empresa_id: empresa_id,
        detalhe: { justificativa, responsavel, situacao_antes: antes.situacao, situacao_depois: depois.situacao, ...extra },
        ip
    }, client);
}

// Começa o teste grátis hoje. Uma vez por empresa: reabrir é decisão da GiroNex (estender com `dias` maior no 1º início ou
// registrar pagamento), e a trava impede reiniciar o teste de quem já usou.
async function iniciarTeste({ empresa_id, dias = DIAS_TESTE_PADRAO, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(empresa_id, async (client) => {
        const antes = await ler(client, empresa_id);

        if (antes.isenta) throw new AppError('A empresa é isenta de cobrança: não há teste grátis a iniciar.', 409);
        if (antes.trial_inicio) throw new AppError(`O teste grátis desta empresa já foi iniciado em ${antes.trial_inicio}.`, 409);

        const inicio = await hoje(client);

        await client.query(
            `INSERT INTO empresa_cobranca (empresa_id, trial_inicio, trial_fim, justificativa, responsavel)
             VALUES ($1, $2::date, $2::date + ($3::int - 1), $4, $5)
             ON CONFLICT (empresa_id) DO UPDATE
                SET trial_inicio = EXCLUDED.trial_inicio, trial_fim = EXCLUDED.trial_fim,
                    justificativa = EXCLUDED.justificativa, responsavel = EXCLUDED.responsavel, atualizado_em = NOW()`,
            [empresa_id, inicio, dias, justificativa, responsavel]
        );

        const depois = await ler(client, empresa_id);
        await gravarEvento(client, { operador_id, ip, acao: 'cobranca_trial_iniciado', empresa_id, antes, depois, justificativa, responsavel, extra: { dias, trial_fim: depois.trial_fim } });

        return depois;
    });
}

// Registra que o cliente pagou e até quando está coberto. Cobrança manual: a GiroNex recebe por fora e marca aqui.
async function registrarPagamento({ empresa_id, pago_ate, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(empresa_id, async (client) => {
        const antes = await ler(client, empresa_id);

        if (antes.isenta) throw new AppError('A empresa é isenta de cobrança: não há pagamento a registrar.', 409);

        const { rows: [limites] } = await client.query(
            `SELECT ${HOJE_SQL}::text AS hoje, (${HOJE_SQL} + $1::int)::text AS teto`, [MAX_DIAS_PAGAMENTO_A_FRENTE]
        );

        if (pago_ate < limites.hoje) throw new AppError('A data de cobertura não pode estar no passado.', 400);
        if (pago_ate > limites.teto) throw new AppError(`A data de cobertura não pode passar de ${MAX_DIAS_PAGAMENTO_A_FRENTE} dias à frente.`, 400);

        await client.query(
            `INSERT INTO empresa_cobranca (empresa_id, pago_ate, justificativa, responsavel)
             VALUES ($1, $2::date, $3, $4)
             ON CONFLICT (empresa_id) DO UPDATE
                SET pago_ate = EXCLUDED.pago_ate, justificativa = EXCLUDED.justificativa,
                    responsavel = EXCLUDED.responsavel, atualizado_em = NOW()`,
            [empresa_id, pago_ate, justificativa, responsavel]
        );

        const depois = await ler(client, empresa_id);
        await gravarEvento(client, { operador_id, ip, acao: 'cobranca_pagamento_registrado', empresa_id, antes, depois, justificativa, responsavel, extra: { pago_ate_antes: antes.pago_ate, pago_ate } });

        return depois;
    });
}

// Isenção: a GiroNex escolhe quem não paga (família, parceiros). Vale para sempre, até remover; independe do plano.
async function definirIsencao({ empresa_id, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(empresa_id, async (client) => {
        const antes = await ler(client, empresa_id);

        if (antes.isenta) throw new AppError('A empresa já é isenta de cobrança.', 409);

        await client.query(
            `INSERT INTO empresa_cobranca (empresa_id, isenta, justificativa, responsavel)
             VALUES ($1, true, $2, $3)
             ON CONFLICT (empresa_id) DO UPDATE
                SET isenta = true, justificativa = EXCLUDED.justificativa,
                    responsavel = EXCLUDED.responsavel, atualizado_em = NOW()`,
            [empresa_id, justificativa, responsavel]
        );

        const depois = await ler(client, empresa_id);
        await gravarEvento(client, { operador_id, ip, acao: 'cobranca_isencao_concedida', empresa_id, antes, depois, justificativa, responsavel });

        return depois;
    });
}

// Tirar a isenção devolve a empresa à regra das datas: se o teste e o pagamento já passaram, ela cai em somente leitura
// na hora. O retorno mostra a situação resultante para o operador não ser pego de surpresa.
async function removerIsencao({ empresa_id, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(empresa_id, async (client) => {
        const antes = await ler(client, empresa_id);

        if (!antes.isenta) throw new AppError('A empresa não é isenta de cobrança.', 409);

        await client.query(
            `UPDATE empresa_cobranca SET isenta = false, justificativa = $2, responsavel = $3, atualizado_em = NOW() WHERE empresa_id = $1`,
            [empresa_id, justificativa, responsavel]
        );

        const depois = await ler(client, empresa_id);
        await gravarEvento(client, { operador_id, ip, acao: 'cobranca_isencao_removida', empresa_id, antes, depois, justificativa, responsavel });

        return depois;
    });
}

// Desligar = empresas.status 'inativa' (já existente): derruba login e tokens na hora. Os dados ficam intactos e a
// empresa pode ser religada. Não é exclusão.
async function mudarStatusDaEmpresa({ empresa_id, de, para, acao, mensagemJaNoEstado, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(empresa_id, async (client) => {
        const antes = await ler(client, empresa_id);

        if (antes.empresa_status !== de) throw new AppError(mensagemJaNoEstado, 409);

        await client.query('UPDATE empresas SET status = $2, atualizado_em = NOW() WHERE id = $1', [empresa_id, para]);

        const depois = await ler(client, empresa_id);
        await gravarEvento(client, { operador_id, ip, acao, empresa_id, antes, depois, justificativa, responsavel, extra: { status_antes: de, status_depois: para } });

        return depois;
    });
}

const desligar = (dados) => mudarStatusDaEmpresa({ ...dados, de: 'ativa', para: 'inativa', acao: 'empresa_desligada', mensagemJaNoEstado: 'A empresa já está desligada.' });
const religar = (dados) => mudarStatusDaEmpresa({ ...dados, de: 'inativa', para: 'ativa', acao: 'empresa_religada', mensagemJaNoEstado: 'A empresa não está desligada.' });

module.exports = { obter, iniciarTeste, registrarPagamento, definirIsencao, removerIsencao, desligar, religar, DIAS_TESTE_PADRAO };
