const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');

// Caixa por PDV (Tarefa 03, PR B). O banco já impõe (migrations 133/134): uma sessão aberta por caixa e por operador, movimento só em
// sessão aberta, insere-só, sessão fechada imutável, FKs compostas por empresa. Este arquivo acrescenta, dentro de UMA transação com a
// linha da sessão (ou do caixa) travada:
//  * abrir: trava o caixa (serializa aberturas e desativação); repetir a MESMA abertura do mesmo operador devolve a sessão (retry);
//  * movimento: trava a sessão; sangria maior que o dinheiro em caixa é recusada; mesma Idempotency-Key com o mesmo conteúdo
//    devolve o movimento original, com outro conteúdo, 409;
//  * fechar: trava a sessão, calcula o ESPERADO no servidor (nunca vem do cliente), grava a conferência e fecha, tudo ou nada.
// PR C: o pagamento de venda e o estorno carregam `caixa_sessao_id`; o esperado de cada forma = troco/suprimentos/sangrias (dinheiro)
// + pagamentos da sessão - estornos da sessão. Venda e estorno travam a sessão (FOR SHARE) antes de gravar: ou entram antes do
// fechamento e contam na conferência, ou o fechamento vence e eles são recusados.
// Toda consulta filtra por empresa_id. O dinheiro é somado em centavos inteiros.

const centavos = (valor) => Math.round(Number(valor) * 100);
const reais = (c) => Number((c / 100).toFixed(2));
const moeda = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

const COLUNAS_SESSAO = `s.id, s.caixa_id, c.nome AS caixa_nome, s.operador_id, u.nome AS operador_nome, s.status, s.saldo_inicial,
    s.aberta_em, s.fechada_em, s.fechada_por, s.justificativa_divergencia`;
const JUNCOES_SESSAO = `FROM caixa_sessoes s
    JOIN caixas c ON c.id = s.caixa_id AND c.empresa_id = s.empresa_id
    JOIN usuarios u ON u.id = s.operador_id AND u.empresa_id = s.empresa_id`;

function sessaoParaResposta(s) {
    return {
        id: Number(s.id),
        caixa_id: Number(s.caixa_id),
        caixa_nome: s.caixa_nome,
        operador_id: Number(s.operador_id),
        operador_nome: s.operador_nome,
        status: s.status,
        saldo_inicial: Number(s.saldo_inicial),
        aberta_em: s.aberta_em,
        fechada_em: s.fechada_em ?? null,
        fechada_por: s.fechada_por === null || s.fechada_por === undefined ? null : Number(s.fechada_por),
        justificativa_divergencia: s.justificativa_divergencia ?? null
    };
}

function movimentoParaResposta(m) {
    return {
        id: Number(m.id),
        sessao_id: Number(m.sessao_id),
        tipo: m.tipo,
        valor: Number(m.valor),
        motivo: m.motivo,
        usuario_id: Number(m.usuario_id),
        criado_em: m.criado_em
    };
}

async function carregarSessao(executor, empresa_id, id) {
    const { rows } = await executor.query(`SELECT ${COLUNAS_SESSAO} ${JUNCOES_SESSAO} WHERE s.empresa_id = $1 AND s.id = $2`, [empresa_id, id]);

    return rows[0] ?? null;
}

// ÚNICO lugar que sabe quanto era esperado em cada forma: pagamentos de venda da sessão - estornos atribuídos a ela; no dinheiro
// soma ainda troco inicial + suprimentos - sangrias. Aparecem no `esperado` o dinheiro (sempre) e as formas com movimento.
// Fora do cálculo (limite conhecido): recebimento de parcela/fiado em dinheiro no balcão, que deve entrar como suprimento.
async function esperadoPorForma(executor, empresa_id, sessao) {
    const { rows: [t] } = await executor.query(
        `SELECT COALESCE(SUM(valor) FILTER (WHERE tipo = 'suprimento'), 0) AS suprimentos,
                COALESCE(SUM(valor) FILTER (WHERE tipo = 'sangria'), 0) AS sangrias
           FROM caixa_movimentos WHERE empresa_id = $1 AND sessao_id = $2`,
        [empresa_id, sessao.id]
    );
    const { rows: vendas } = await executor.query(
        `SELECT forma_pagamento AS forma, SUM(valor) AS total FROM pagamentos_venda
          WHERE empresa_id = $1 AND caixa_sessao_id = $2 AND status <> 'cancelado' GROUP BY forma_pagamento`,
        [empresa_id, sessao.id]
    );
    const { rows: estornos } = await executor.query(
        `SELECT pv.forma_pagamento AS forma, SUM(e.valor) AS total
           FROM estornos_pagamento e JOIN pagamentos_venda pv ON pv.id = e.pagamento_id AND pv.empresa_id = e.empresa_id
          WHERE e.empresa_id = $1 AND e.caixa_sessao_id = $2 GROUP BY pv.forma_pagamento`,
        [empresa_id, sessao.id]
    );

    const suprimentos = centavos(t.suprimentos);
    const sangrias = centavos(t.sangrias);
    const porForma = { dinheiro: { vendas: 0, estornos: 0 } };

    for (const v of vendas) (porForma[v.forma] ??= { vendas: 0, estornos: 0 }).vendas = centavos(v.total);
    for (const e of estornos) (porForma[e.forma] ??= { vendas: 0, estornos: 0 }).estornos = centavos(e.total);

    const esperadoCentavos = {};
    const detalhe = {};

    for (const [forma, x] of Object.entries(porForma)) {
        esperadoCentavos[forma] = x.vendas - x.estornos + (forma === 'dinheiro' ? centavos(sessao.saldo_inicial) + suprimentos - sangrias : 0);
        detalhe[forma] = { vendas: reais(x.vendas), estornos: reais(x.estornos), esperado: reais(esperadoCentavos[forma]) };
    }

    return {
        resumo: { saldo_inicial: Number(sessao.saldo_inicial), suprimentos: Number(t.suprimentos), sangrias: Number(t.sangrias) },
        esperado: Object.fromEntries(Object.entries(esperadoCentavos).map(([forma, c]) => [forma, reais(c)])),
        por_forma: detalhe,
        centavos: esperadoCentavos
    };
}

// Sessão aberta do operador (ou null). Com `travar`, FOR SHARE: o fechamento (FOR UPDATE) espera quem está gravando um pagamento.
async function sessaoAbertaDoOperador(executor, empresa_id, operador_id, { travar = false } = {}) {
    const { rows } = await executor.query(
        `SELECT id FROM caixa_sessoes WHERE empresa_id = $1 AND operador_id = $2 AND status = 'aberta'${travar ? ' FOR SHARE' : ''}`,
        [empresa_id, operador_id]
    );

    return rows.length ? Number(rows[0].id) : null;
}

// Dentro da transação da venda: confirma que a sessão ainda está aberta e a trava contra um fechamento concorrente.
async function travarSessaoAberta(client, empresa_id, sessao_id) {
    const { rowCount } = await client.query(
        `SELECT 1 FROM caixa_sessoes WHERE id = $1 AND empresa_id = $2 AND status = 'aberta' FOR SHARE`, [sessao_id, empresa_id]
    );

    if (!rowCount) throw new AppError('O caixa foi fechado. Abra o caixa para vender', 409);
}

// De qual sessão o valor SAI num estorno: a do pagamento original, se ainda aberta; senão a do operador que estorna; senão nenhuma.
async function sessaoParaEstorno(client, { empresa_id, usuario_id, sessao_original_id = null }) {
    if (sessao_original_id) {
        const { rowCount } = await client.query(
            `SELECT 1 FROM caixa_sessoes WHERE id = $1 AND empresa_id = $2 AND status = 'aberta' FOR SHARE`, [sessao_original_id, empresa_id]
        );

        if (rowCount) return Number(sessao_original_id);
    }

    return sessaoAbertaDoOperador(client, empresa_id, usuario_id, { travar: true });
}

// ---- caixas ----

async function listarCaixas({ empresa_id, incluirInativos }) {
    const { rows } = await db.query(
        `SELECT c.id, c.nome, c.ativo, c.criado_em, s.id AS sessao_id, s.operador_id, u.nome AS operador_nome, s.aberta_em
           FROM caixas c
           LEFT JOIN caixa_sessoes s ON s.caixa_id = c.id AND s.empresa_id = c.empresa_id AND s.status = 'aberta'
           LEFT JOIN usuarios u ON u.id = s.operador_id AND u.empresa_id = s.empresa_id
          WHERE c.empresa_id = $1 AND ($2::boolean OR c.ativo)
          ORDER BY lower(c.nome), c.id`,
        [empresa_id, incluirInativos]
    );

    return rows.map((r) => ({
        id: Number(r.id),
        nome: r.nome,
        ativo: r.ativo,
        criado_em: r.criado_em,
        sessao_aberta: r.sessao_id ? { id: Number(r.sessao_id), operador_id: Number(r.operador_id), operador_nome: r.operador_nome, aberta_em: r.aberta_em } : null
    }));
}

async function criarCaixa({ empresa_id, usuario_id, nome }) {
    try {
        const { rows: [c] } = await db.query(
            `INSERT INTO caixas (empresa_id, nome, criado_por) VALUES ($1, $2, $3) RETURNING id, nome, ativo, criado_em`,
            [empresa_id, nome, usuario_id]
        );

        return { id: Number(c.id), nome: c.nome, ativo: c.ativo, criado_em: c.criado_em, sessao_aberta: null };
    } catch (error) {
        if (error.code === '23505') throw new AppError('Já existe um caixa com este nome', 409);

        throw error;
    }
}

async function atualizarCaixa({ empresa_id, caixa_id, ativo }) {
    return executarComLock('caixas', { coluna: 'id', valor: caixa_id }, empresa_id, undefined, async (caixa, client) => {
        if (!caixa) throw new AppError('Caixa não encontrado', 404);

        if (!ativo) {
            const { rowCount } = await client.query(
                `SELECT 1 FROM caixa_sessoes WHERE empresa_id = $1 AND caixa_id = $2 AND status = 'aberta'`, [empresa_id, caixa_id]
            );

            if (rowCount > 0) throw new AppError('Feche a sessão aberta antes de desativar o caixa', 409);
        }

        const { rows: [c] } = await client.query(
            `UPDATE caixas SET ativo = $3 WHERE id = $1 AND empresa_id = $2 RETURNING id, nome, ativo, criado_em`, [caixa_id, empresa_id, ativo]
        );

        return { id: Number(c.id), nome: c.nome, ativo: c.ativo, criado_em: c.criado_em };
    });
}

// ---- sessões ----

async function abrirSessao({ empresa_id, usuario_id, caixa_id, saldo_inicial }) {
    // Trava o CAIXA: duas aberturas do mesmo caixa, ou uma abertura e uma desativação, não se cruzam.
    return executarComLock('caixas', { coluna: 'id', valor: caixa_id }, empresa_id, undefined, async (caixa, client) => {
        if (!caixa) throw new AppError('Caixa não encontrado', 404);
        if (!caixa.ativo) throw new AppError('Este caixa está desativado', 409);

        const { rows: abertas } = await client.query(
            `SELECT id, caixa_id, operador_id, saldo_inicial FROM caixa_sessoes
              WHERE empresa_id = $1 AND status = 'aberta' AND (caixa_id = $2 OR operador_id = $3)`,
            [empresa_id, caixa_id, usuario_id]
        );

        const doCaixa = abertas.find((a) => Number(a.caixa_id) === caixa_id);

        if (doCaixa) {
            // Retry de uma abertura que já deu certo: mesmo operador, mesmo caixa, mesmo troco -> devolve a sessão.
            if (Number(doCaixa.operador_id) === usuario_id && centavos(doCaixa.saldo_inicial) === centavos(saldo_inicial)) {
                return { sessao: sessaoParaResposta(await carregarSessao(client, empresa_id, doCaixa.id)), reaproveitada: true };
            }

            throw new AppError('Este caixa já está aberto', 409);
        }

        if (abertas.length > 0) throw new AppError('Você já tem um caixa aberto. Feche-o antes de abrir outro', 409);

        try {
            const { rows: [criada] } = await client.query(
                `INSERT INTO caixa_sessoes (empresa_id, caixa_id, operador_id, saldo_inicial) VALUES ($1, $2, $3, $4) RETURNING id`,
                [empresa_id, caixa_id, usuario_id, saldo_inicial]
            );

            return { sessao: sessaoParaResposta(await carregarSessao(client, empresa_id, criada.id)), reaproveitada: false };
        } catch (error) {
            // Rede de segurança: o índice único do banco vence qualquer corrida que escape da checagem acima.
            if (error.code === '23505') throw new AppError('Este caixa já está aberto ou você já tem um caixa aberto', 409);

            throw error;
        }
    });
}

async function sessaoAberta({ empresa_id, operador_id }) {
    const { rows } = await db.query(
        `SELECT s.id FROM caixa_sessoes s WHERE s.empresa_id = $1 AND s.operador_id = $2 AND s.status = 'aberta'`, [empresa_id, operador_id]
    );

    return rows.length ? detalharSessao({ empresa_id, sessao_id: Number(rows[0].id) }) : null;
}

async function detalharSessao({ empresa_id, sessao_id }) {
    const sessao = await carregarSessao(db, empresa_id, sessao_id);

    if (!sessao) return null;

    const { rows: movimentos } = await db.query(
        `SELECT id, sessao_id, tipo, valor, motivo, usuario_id, criado_em FROM caixa_movimentos WHERE empresa_id = $1 AND sessao_id = $2 ORDER BY id`,
        [empresa_id, sessao_id]
    );
    const { resumo, esperado, por_forma } = await esperadoPorForma(db, empresa_id, sessao);
    const { rows: conferencias } = await db.query(
        `SELECT forma, esperado, informado, diferenca FROM caixa_conferencias WHERE empresa_id = $1 AND sessao_id = $2 ORDER BY id`, [empresa_id, sessao_id]
    );

    return {
        sessao: sessaoParaResposta(sessao),
        movimentos: movimentos.map(movimentoParaResposta),
        resumo,
        esperado,
        por_forma,
        conferencias: conferencias.map((c) => ({ forma: c.forma, esperado: Number(c.esperado), informado: Number(c.informado), diferenca: Number(c.diferenca) }))
    };
}

async function listarSessoes({ empresa_id, operador_id = null, status = null, caixa_id = null, limit, offset }) {
    const filtros = `s.empresa_id = $1 AND ($2::int IS NULL OR s.operador_id = $2) AND ($3::text IS NULL OR s.status = $3) AND ($4::int IS NULL OR s.caixa_id = $4)`;
    const params = [empresa_id, operador_id, status, caixa_id];
    const { rows } = await db.query(
        `SELECT ${COLUNAS_SESSAO} ${JUNCOES_SESSAO} WHERE ${filtros} ORDER BY s.aberta_em DESC, s.id DESC LIMIT $5 OFFSET $6`, [...params, limit, offset]
    );
    const { rows: [{ total }] } = await db.query(`SELECT COUNT(*)::int AS total FROM caixa_sessoes s WHERE ${filtros}`, params);

    return { itens: rows.map(sessaoParaResposta), total };
}

// Dono da sessão (ou quem gere os caixas) pode mexer nela; para os demais a sessão "não existe".
const podeMexer = (sessao, { usuario_id, gere }) => gere || Number(sessao.operador_id) === usuario_id;

async function lancarMovimento({ empresa_id, usuario_id, gere, sessao_id, tipo, valor, motivo, chave }) {
    const cents = centavos(valor);

    return executarComLock('caixa_sessoes', { coluna: 'id', valor: sessao_id }, empresa_id, undefined, async (linha, client) => {
        if (!linha || !podeMexer(linha, { usuario_id, gere })) throw new AppError('Sessão de caixa não encontrada', 404);

        const { rows: [existente] } = await client.query(
            `SELECT id, sessao_id, tipo, valor, motivo, usuario_id, criado_em FROM caixa_movimentos WHERE empresa_id = $1 AND chave_idempotencia = $2`, [empresa_id, chave]
        );

        if (existente) {
            const mesmo = Number(existente.sessao_id) === sessao_id && existente.tipo === tipo && centavos(existente.valor) === cents && existente.motivo === motivo;

            if (!mesmo) throw new AppError('Idempotency-Key já usada com outro conteúdo', 409);

            return { movimento: movimentoParaResposta(existente), reaproveitado: true };
        }

        if (linha.status !== 'aberta') throw new AppError('A sessão de caixa já está fechada', 409);

        if (tipo === 'sangria') {
            const sessao = await carregarSessao(client, empresa_id, sessao_id);
            const { centavos: { dinheiro } } = await esperadoPorForma(client, empresa_id, sessao);

            if (cents > dinheiro) {
                throw new AppError(`A sangria (${moeda(cents)}) é maior que o dinheiro em caixa (${moeda(dinheiro)})`, 422);
            }
        }

        const { rows: [criado] } = await client.query(
            `INSERT INTO caixa_movimentos (empresa_id, sessao_id, tipo, valor, motivo, usuario_id, chave_idempotencia)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, sessao_id, tipo, valor, motivo, usuario_id, criado_em`,
            [empresa_id, sessao_id, tipo, reais(cents), motivo, usuario_id, chave]
        );

        return { movimento: movimentoParaResposta(criado), reaproveitado: false };
    });
}

async function fecharSessao({ empresa_id, usuario_id, gere, sessao_id, conferencia, justificativa }) {
    return executarComLock('caixa_sessoes', { coluna: 'id', valor: sessao_id }, empresa_id, undefined, async (linha, client) => {
        if (!linha || !podeMexer(linha, { usuario_id, gere })) throw new AppError('Sessão de caixa não encontrada', 404);
        if (linha.status !== 'aberta') throw new AppError('A sessão de caixa já está fechada', 409);

        const sessao = await carregarSessao(client, empresa_id, sessao_id);
        const { esperado, centavos: esperadoCentavos } = await esperadoPorForma(client, empresa_id, sessao);
        const formasEsperadas = Object.keys(esperado);
        const informadas = conferencia.map((c) => c.forma);

        // Toda forma que tem esperado (o dinheiro sempre, e as com vendas/estornos) precisa ser conferida: fechar sem contar esconderia a diferença.
        const faltando = formasEsperadas.filter((forma) => !informadas.includes(forma));

        if (faltando.length) throw new AppError(`Informe a conferência de: ${faltando.join(', ')}`, 400);

        const linhas = conferencia.map((c) => ({
            forma: c.forma, esperado: esperado[c.forma] ?? 0, informado: c.informado, diferenca: reais(centavos(c.informado) - (esperadoCentavos[c.forma] ?? 0))
        }));
        const divergente = linhas.some((l) => l.diferenca !== 0);

        if (divergente && !(justificativa && justificativa.length >= 3)) {
            throw new AppError('Há diferença na conferência: informe a justificativa (mínimo 3 caracteres)', 400);
        }

        for (const l of linhas) {
            await client.query(
                `INSERT INTO caixa_conferencias (empresa_id, sessao_id, forma, esperado, informado) VALUES ($1, $2, $3, $4, $5)`,
                [empresa_id, sessao_id, l.forma, l.esperado, l.informado]
            );
        }

        await client.query(
            `UPDATE caixa_sessoes SET status = 'fechada', fechada_em = NOW(), fechada_por = $3, justificativa_divergencia = $4
              WHERE id = $1 AND empresa_id = $2`,
            [sessao_id, empresa_id, usuario_id, divergente ? justificativa : null]
        );

        return { divergente, conferencias: linhas, sessao: sessaoParaResposta(await carregarSessao(client, empresa_id, sessao_id)) };
    });
}

module.exports = {
    listarCaixas, criarCaixa, atualizarCaixa, abrirSessao, sessaoAberta, detalharSessao, listarSessoes, lancarMovimento, fecharSessao, esperadoPorForma,
    sessaoAbertaDoOperador, travarSessaoAberta, sessaoParaEstorno
};
