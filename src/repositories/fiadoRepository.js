const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');

// Fiado: livro-razão append-only + saldo por cliente. Regras que este arquivo garante, TODAS dentro de uma transação com a
// linha do saldo do cliente travada (executarComLock):
//  * o saldo guardado é atualizado junto do lançamento e o banco recusa saldo negativo (CHECK);
//  * pagamento maior que o saldo é recusado; estorno que deixaria o saldo negativo é recusado;
//  * o mesmo Idempotency-Key com o mesmo conteúdo devolve o lançamento original; com outro conteúdo, 409;
//  * lançamento nunca é editado nem apagado (o banco recusa): correção é estorno, e cada lançamento só é estornado uma vez.
// Toda consulta filtra por empresa_id. `escopo` (id do usuário) limita aos clientes que ele cadastrou, quando ele não tem
// a capacidade de ver todos os clientes; undefined = sem restrição (mesma regra de /clientes).

const centavos = (valor) => Math.round(Number(valor) * 100);
const reais = (c) => Number((c / 100).toFixed(2));
const moeda = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
const HOJE_SP = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

function lancamentoParaResposta(l) {
    return {
        id: Number(l.id),
        tipo: l.tipo,
        valor: Number(l.valor),
        descricao: l.descricao ?? null,
        data_lancamento: l.data_lancamento_texto ?? l.data_lancamento,
        forma: l.forma ?? null,
        estorna_id: l.estorna_id === null || l.estorna_id === undefined ? null : Number(l.estorna_id),
        motivo: l.motivo ?? null,
        estornado: l.estornado === true,
        criado_em: l.criado_em
    };
}

const COLUNAS_LANCAMENTO = `l.id, l.cliente_id, l.tipo, l.valor, l.descricao, to_char(l.data_lancamento, 'YYYY-MM-DD') AS data_lancamento_texto,
        l.forma, l.estorna_id, l.motivo, l.criado_em`;

async function buscarCliente(executor, empresa_id, cliente_id, escopo) {
    const { rows } = await executor.query(
        `SELECT id, nome, telefone, ativo, anonimizado FROM clientes
          WHERE id = $1 AND empresa_id = $2 AND ($3::int IS NULL OR criado_por = $3)`,
        [cliente_id, empresa_id, escopo ?? null]
    );

    return rows[0] ?? null;
}

async function garantirSaldo(empresa_id, cliente_id) {
    await db.query('INSERT INTO fiado_saldos (empresa_id, cliente_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [empresa_id, cliente_id]);
}

async function buscarPorChave(client, empresa_id, chave) {
    const { rows } = await client.query(
        `SELECT ${COLUNAS_LANCAMENTO} FROM fiado_lancamentos l WHERE l.empresa_id = $1 AND l.chave_idempotencia = $2`,
        [empresa_id, chave]
    );

    return rows[0] ?? null;
}

function conflitoDeChave(error) {
    if (error && error.code === '23505') {
        return new AppError('Idempotency-Key já usada com outro conteúdo', 409);
    }

    return error;
}

// Compra (soma) ou pagamento (subtrai). A data vem como YYYY-MM-DD (sem conversão de fuso) e não pode ser futura.
async function lancar({ empresa_id, usuario_id, cliente_id, tipo, valor, descricao = null, data = null, forma = null, chave, escopo }) {
    const cliente = await buscarCliente(db, empresa_id, cliente_id, escopo);

    if (!cliente) throw new AppError('Cliente não encontrado', 404);
    if (!cliente.ativo || cliente.anonimizado) throw new AppError('Cliente inativo ou anonimizado não recebe lançamentos', 409);

    const cents = centavos(valor);

    await garantirSaldo(empresa_id, cliente_id);

    try {
        return await executarComLock('fiado_saldos', { coluna: 'cliente_id', valor: cliente_id }, empresa_id, undefined, async (linha, client) => {
            const existente = await buscarPorChave(client, empresa_id, chave);

            if (existente) {
                const mesmo = Number(existente.cliente_id) === cliente_id && existente.tipo === tipo && centavos(existente.valor) === cents
                    && (existente.descricao ?? null) === (descricao ?? null) && (existente.forma ?? null) === (forma ?? null);

                if (!mesmo) throw new AppError('Idempotency-Key já usada com outro conteúdo', 409);

                return { lancamento: lancamentoParaResposta(existente), saldo: Number(linha.saldo), reaproveitado: true };
            }

            if (data) {
                const { rows: [{ ok }] } = await client.query(`SELECT ($1::date <= ${HOJE_SP}) AS ok`, [data]);

                if (!ok) throw new AppError('A data do lançamento não pode ser futura', 400);
            }

            const saldoAtual = centavos(linha.saldo);

            if (tipo === 'pagamento' && cents > saldoAtual) {
                throw new AppError(`O pagamento (${moeda(cents)}) é maior que o saldo devedor (${moeda(saldoAtual)})`, 422);
            }

            const novoSaldo = tipo === 'compra' ? saldoAtual + cents : saldoAtual - cents;

            const { rows: [criado] } = await client.query(
                `INSERT INTO fiado_lancamentos (empresa_id, cliente_id, tipo, valor, descricao, data_lancamento, forma, chave_idempotencia, criado_por)
                 VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, ${HOJE_SP}), $7, $8, $9)
                 RETURNING id, cliente_id, tipo, valor, descricao, to_char(data_lancamento, 'YYYY-MM-DD') AS data_lancamento_texto, forma, estorna_id, motivo, criado_em`,
                [empresa_id, cliente_id, tipo, reais(cents), descricao, data, forma, chave, usuario_id]
            );

            await client.query(
                'UPDATE fiado_saldos SET saldo = $3, atualizado_em = NOW() WHERE empresa_id = $1 AND cliente_id = $2',
                [empresa_id, cliente_id, reais(novoSaldo)]
            );

            return { lancamento: lancamentoParaResposta(criado), saldo: reais(novoSaldo), reaproveitado: false };
        });
    } catch (error) {
        throw conflitoDeChave(error);
    }
}

// Estorno: o lançamento original permanece; nasce um lançamento `estorno` que inverte o efeito dele.
async function estornar({ empresa_id, usuario_id, lancamento_id, motivo, chave, escopo }) {
    const { rows: [alvo] } = await db.query(
        `SELECT l.id, l.cliente_id FROM fiado_lancamentos l
           JOIN clientes c ON c.id = l.cliente_id AND c.empresa_id = l.empresa_id
          WHERE l.id = $1 AND l.empresa_id = $2 AND ($3::int IS NULL OR c.criado_por = $3)`,
        [lancamento_id, empresa_id, escopo ?? null]
    );

    if (!alvo) throw new AppError('Lançamento não encontrado', 404);

    const cliente_id = Number(alvo.cliente_id);

    try {
        return await executarComLock('fiado_saldos', { coluna: 'cliente_id', valor: cliente_id }, empresa_id, undefined, async (linha, client) => {
            const existente = await buscarPorChave(client, empresa_id, chave);

            if (existente) {
                if (existente.tipo !== 'estorno' || Number(existente.estorna_id) !== lancamento_id || existente.motivo !== motivo) {
                    throw new AppError('Idempotency-Key já usada com outro conteúdo', 409);
                }

                return { lancamento: lancamentoParaResposta(existente), saldo: Number(linha.saldo), reaproveitado: true };
            }

            const { rows: [original] } = await client.query('SELECT * FROM fiado_lancamentos WHERE id = $1 AND empresa_id = $2', [lancamento_id, empresa_id]);

            if (original.tipo === 'estorno') throw new AppError('Um estorno não pode ser estornado', 422);

            const { rows: jaEstornado } = await client.query('SELECT 1 FROM fiado_lancamentos WHERE estorna_id = $1 AND empresa_id = $2', [lancamento_id, empresa_id]);

            if (jaEstornado.length) throw new AppError('Este lançamento já foi estornado', 409);

            const cents = centavos(original.valor);
            const saldoAtual = centavos(linha.saldo);
            const novoSaldo = original.tipo === 'compra' ? saldoAtual - cents : saldoAtual + cents;

            if (novoSaldo < 0) {
                throw new AppError('Este estorno deixaria o saldo do cliente negativo. Estorne antes os pagamentos feitos depois desta compra.', 422);
            }

            const { rows: [criado] } = await client.query(
                `INSERT INTO fiado_lancamentos (empresa_id, cliente_id, tipo, valor, data_lancamento, estorna_id, motivo, chave_idempotencia, criado_por)
                 VALUES ($1, $2, 'estorno', $3, ${HOJE_SP}, $4, $5, $6, $7)
                 RETURNING id, cliente_id, tipo, valor, descricao, to_char(data_lancamento, 'YYYY-MM-DD') AS data_lancamento_texto, forma, estorna_id, motivo, criado_em`,
                [empresa_id, cliente_id, original.valor, lancamento_id, motivo, chave, usuario_id]
            );

            await client.query(
                'UPDATE fiado_saldos SET saldo = $3, atualizado_em = NOW() WHERE empresa_id = $1 AND cliente_id = $2',
                [empresa_id, cliente_id, reais(novoSaldo)]
            );

            return { lancamento: lancamentoParaResposta(criado), saldo: reais(novoSaldo), reaproveitado: false };
        });
    } catch (error) {
        throw conflitoDeChave(error);
    }
}

// Clientes com o saldo de fiado. `comSaldo` = só devedores. Busca por nome (parte) ou telefone (só dígitos).
async function listarClientes({ empresa_id, busca, comSaldo, limit, offset, escopo }) {
    const termo = busca ? `%${busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const digitos = busca ? busca.replace(/\D/g, '') : '';
    const telefone = digitos.length >= 3 ? `%${digitos}%` : null;

    const filtro = `c.empresa_id = $1 AND c.ativo = true AND c.anonimizado = false
        AND ($2::int IS NULL OR c.criado_por = $2)
        AND ($3::text IS NULL OR c.nome ILIKE $3 OR ($4::text IS NOT NULL AND regexp_replace(COALESCE(c.telefone, ''), '\\D', '', 'g') LIKE $4))
        AND ($5::boolean = false OR COALESCE(s.saldo, 0) > 0)`;
    const params = [empresa_id, escopo ?? null, termo, telefone, comSaldo === true];

    const { rows } = await db.query(
        `SELECT c.id, c.nome, c.telefone, COALESCE(s.saldo, 0) AS saldo
           FROM clientes c LEFT JOIN fiado_saldos s ON s.cliente_id = c.id AND s.empresa_id = c.empresa_id
          WHERE ${filtro}
          ORDER BY COALESCE(s.saldo, 0) DESC, c.nome ASC, c.id ASC LIMIT $6 OFFSET $7`,
        [...params, limit, offset]
    );
    const { rows: [{ total }] } = await db.query(
        `SELECT COUNT(*)::int AS total FROM clientes c LEFT JOIN fiado_saldos s ON s.cliente_id = c.id AND s.empresa_id = c.empresa_id WHERE ${filtro}`,
        params
    );

    return { itens: rows.map((r) => ({ id: r.id, nome: r.nome, telefone: r.telefone, saldo: Number(r.saldo) })), total };
}

// Extrato do cliente: saldo do fiado, lançamentos (mais novos primeiro) e, só para leitura, o que ele ainda deve no crediário
// do PDV (parcelas pendentes em contas a receber). Os dois são mostrados separados: nunca se misturam nos totais do fiado.
async function extrato({ empresa_id, cliente_id, limit, offset, escopo }) {
    const cliente = await buscarCliente(db, empresa_id, cliente_id, escopo);

    if (!cliente) throw new AppError('Cliente não encontrado', 404);

    const { rows: [s] } = await db.query('SELECT saldo FROM fiado_saldos WHERE empresa_id = $1 AND cliente_id = $2', [empresa_id, cliente_id]);
    const { rows } = await db.query(
        `SELECT ${COLUNAS_LANCAMENTO},
                EXISTS (SELECT 1 FROM fiado_lancamentos e WHERE e.estorna_id = l.id AND e.empresa_id = l.empresa_id) AS estornado
           FROM fiado_lancamentos l WHERE l.empresa_id = $1 AND l.cliente_id = $2
          ORDER BY l.id DESC LIMIT $3 OFFSET $4`,
        [empresa_id, cliente_id, limit, offset]
    );
    const { rows: [{ total }] } = await db.query('SELECT COUNT(*)::int AS total FROM fiado_lancamentos WHERE empresa_id = $1 AND cliente_id = $2', [empresa_id, cliente_id]);
    const { rows: parcelas } = await db.query(
        `SELECT cr.id, cr.descricao, cr.valor, to_char(cr.data_vencimento, 'YYYY-MM-DD') AS data_vencimento
           FROM contas_receber cr JOIN vendas v ON v.id = cr.venda_id AND v.empresa_id = cr.empresa_id
          WHERE cr.empresa_id = $1 AND v.cliente_id = $2 AND cr.status = 'pendente'
          ORDER BY cr.data_vencimento ASC, cr.id ASC`,
        [empresa_id, cliente_id]
    );
    const totalCrediario = parcelas.reduce((acc, p) => acc + centavos(p.valor), 0);

    return {
        cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone },
        saldo: s ? Number(s.saldo) : 0,
        lancamentos: rows.map(lancamentoParaResposta),
        total_lancamentos: total,
        crediario: {
            total: reais(totalCrediario),
            parcelas: parcelas.map((p) => ({ id: p.id, descricao: p.descricao, valor: Number(p.valor), data_vencimento: p.data_vencimento }))
        }
    };
}

// Painel: total a receber, devedores e movimento do período (padrão: do dia 1 do mês até hoje, em America/Sao_Paulo).
// Compras e pagamentos do período já descontam os estornos (um estorno de compra reduz as compras; de pagamento, os pagamentos).
async function resumo({ empresa_id, de = null, ate = null, escopo }) {
    const escopado = 'AND ($2::int IS NULL OR c.criado_por = $2)';
    const { rows: [saldos] } = await db.query(
        `SELECT COALESCE(SUM(s.saldo), 0) AS total, COUNT(*) FILTER (WHERE s.saldo > 0)::int AS devedores
           FROM fiado_saldos s JOIN clientes c ON c.id = s.cliente_id AND c.empresa_id = s.empresa_id
          WHERE s.empresa_id = $1 ${escopado}`,
        [empresa_id, escopo ?? null]
    );
    const { rows: [periodo] } = await db.query(
        `SELECT COALESCE(SUM(CASE WHEN l.tipo = 'compra' THEN l.valor WHEN l.tipo = 'estorno' AND o.tipo = 'compra' THEN -l.valor ELSE 0 END), 0) AS compras,
                COALESCE(SUM(CASE WHEN l.tipo = 'pagamento' THEN l.valor WHEN l.tipo = 'estorno' AND o.tipo = 'pagamento' THEN -l.valor ELSE 0 END), 0) AS pagamentos,
                COALESCE($3::date, date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')::date)::text AS de,
                COALESCE($4::date, ${HOJE_SP})::text AS ate
           FROM fiado_lancamentos l
           JOIN clientes c ON c.id = l.cliente_id AND c.empresa_id = l.empresa_id
           LEFT JOIN fiado_lancamentos o ON o.id = l.estorna_id AND o.empresa_id = l.empresa_id
          WHERE l.empresa_id = $1 ${escopado}
            AND l.data_lancamento BETWEEN COALESCE($3::date, date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AND COALESCE($4::date, ${HOJE_SP})`,
        [empresa_id, escopo ?? null, de, ate]
    );
    const { rows: [crediario] } = await db.query(
        `SELECT COALESCE(SUM(cr.valor), 0) AS total
           FROM contas_receber cr JOIN vendas v ON v.id = cr.venda_id AND v.empresa_id = cr.empresa_id
           LEFT JOIN clientes c ON c.id = v.cliente_id AND c.empresa_id = v.empresa_id
          WHERE cr.empresa_id = $1 AND cr.status = 'pendente' ${escopado}`,
        [empresa_id, escopo ?? null]
    );
    const { rows: ultimas } = await db.query(
        `SELECT ${COLUNAS_LANCAMENTO}, c.nome AS cliente_nome
           FROM fiado_lancamentos l JOIN clientes c ON c.id = l.cliente_id AND c.empresa_id = l.empresa_id
          WHERE l.empresa_id = $1 ${escopado}
          ORDER BY l.id DESC LIMIT 10`,
        [empresa_id, escopo ?? null]
    );

    return {
        total_a_receber: Number(saldos.total),
        clientes_devedores: saldos.devedores,
        periodo: { de: periodo.de, ate: periodo.ate, compras: Number(periodo.compras), pagamentos: Number(periodo.pagamentos) },
        crediario_a_receber: Number(crediario.total),
        ultimas_movimentacoes: ultimas.map((l) => ({ ...lancamentoParaResposta(l), cliente_id: Number(l.cliente_id), cliente_nome: l.cliente_nome }))
    };
}

// Para a cobrança: cliente (no escopo) e saldo atual.
async function clienteComSaldo({ empresa_id, cliente_id, escopo }) {
    const cliente = await buscarCliente(db, empresa_id, cliente_id, escopo);

    if (!cliente) throw new AppError('Cliente não encontrado', 404);

    const { rows: [s] } = await db.query('SELECT saldo FROM fiado_saldos WHERE empresa_id = $1 AND cliente_id = $2', [empresa_id, cliente_id]);

    return { cliente, saldo: s ? Number(s.saldo) : 0 };
}

module.exports = { lancar, estornar, listarClientes, extrato, resumo, clienteComSaldo };
