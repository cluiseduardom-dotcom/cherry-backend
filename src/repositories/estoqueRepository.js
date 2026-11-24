const db = require('../config/db');
const AppError = require('../errors/AppError');
const unidadesRepository = require('./unidadesRastreadasRepository');
const { sqlDiaSP } = require('../utils/dataSaoPaulo');

// Local Central da empresa. Criado sob demanda para empresas novas (a migration 058 já cobre
// as existentes); ON CONFLICT DO NOTHING + SELECT é seguro com criações concorrentes.
async function garantirLocalCentral(client, empresa_id) {
    await client.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'central', 'Central') ON CONFLICT DO NOTHING`,
        [empresa_id]
    );
    const { rows } = await client.query(
        `SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'central'`,
        [empresa_id]
    );
    return rows[0].id;
}

// Local "Reserva online" da empresa (mercadoria separada para um pedido da loja que ainda não foi pago).
// Mesmo padrão do Central. Só o fluxo da loja pode movimentá-lo (ver `permitirReserva` em criarMovimentacao).
async function garantirLocalReserva(client, empresa_id) {
    await client.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'reserva', 'Reserva online') ON CONFLICT DO NOTHING`,
        [empresa_id]
    );
    const { rows } = await client.query(
        `SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'reserva'`,
        [empresa_id]
    );
    return rows[0].id;
}

// Local "Em trânsito" da empresa (mercadoria enviada e ainda não aceita). Mesmo padrão do Central.
async function garantirLocalTransito(client, empresa_id) {
    await client.query(
        `INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES ($1, 'transito', 'Em trânsito') ON CONFLICT DO NOTHING`,
        [empresa_id]
    );
    const { rows } = await client.query(
        `SELECT id FROM locais_estoque WHERE empresa_id = $1 AND tipo = 'transito'`,
        [empresa_id]
    );
    return rows[0].id;
}

// Rastreio por unidade (ADR-008). `rastreio` (opcional) vem de quem chama:
//   identificadores: lista digitada/lida (um por unidade);
//   compra_id: liga a unidade à compra de origem;
//   destinoSaida: 'vendida' (venda) ou 'baixada' (baixa avulsa, padrão);
//   reativar: true no cancelamento de venda (as unidades vendidas voltam a em_estoque);
//   baixarDaCompraId: estorno de compra (todas as unidades dela saem como baixada);
//   referencia: texto do histórico (ex.: 'venda:12'; padrão 'mov:<id>').
// Produto rastreado só se move por entrada, saída ou devolução COM unidades. Ajuste de quantidade e transferência entre
// locais ficam fora desta entrega: seriam saldo sem unidade, o que descasa o saldo da contagem de unidades.
function prepararRastreio({ rastreado, tipo, quantidade, transferencia_id, rastreio }) {
    const informados = rastreio?.identificadores;

    if (!rastreado) {
        if (Array.isArray(informados) && informados.length) {
            throw new AppError('Este produto não é rastreado por IMEI/série', 400);
        }
        return null;
    }

    if (transferencia_id) {
        throw new AppError('Produto rastreado por IMEI/série não pode ser transferido entre locais nesta versão', 409);
    }

    if (tipo === 'ajuste') {
        throw new AppError('Produto rastreado por IMEI/série não aceita ajuste de quantidade. Dê baixa informando o IMEI/série ou registre uma entrada com os identificadores', 409);
    }

    if (tipo === 'saida' && rastreio?.baixarDaCompraId) {
        return null;
    }

    return unidadesRepository.prepararIdentificadores(informados, quantidade);
}

async function aplicarRastreio(client, { tipo, produto_id, empresa_id, usuario_id, rastreio, identificadores, movimentacao }) {
    const referencia = rastreio?.referencia ?? `mov:${movimentacao.id}`;

    if (tipo === 'entrada') {
        if (rastreio?.reativar) {
            await unidadesRepository.reativarDaVenda(client, {
                empresa_id, produto_id, identificadores: identificadores.map((i) => i.identificador), referencia, usuario_id
            });
            return;
        }

        await unidadesRepository.registrarEntrada(client, {
            empresa_id, produto_id, identificadores, compra_id: rastreio?.compra_id, usuario_id, referencia
        });
        return;
    }

    // saída
    if (rastreio?.baixarDaCompraId) {
        await unidadesRepository.baixarDaCompra(client, { empresa_id, produto_id, compra_id: rastreio.baixarDaCompraId, usuario_id });
        return;
    }

    const vendida = rastreio?.destinoSaida === 'vendida';

    await unidadesRepository.baixarPorIdentificadores(client, {
        empresa_id,
        produto_id,
        identificadores,
        statusNovo: vendida ? 'vendida' : 'baixada',
        evento: vendida ? 'venda' : 'baixa',
        referencia,
        motivo: vendida ? null : movimentacao.motivo,
        usuario_id
    });
}

// clienteExterno permite participar de uma transação já aberta por outro módulo
// (ex: criação de venda, que precisa que a baixa de estoque de todos os itens e o
// registro da venda sejam a mesma transação). Quando informado, esta função não
// abre/fecha transação nem libera a conexão — quem chamou é responsável por isso.
//
// Estoque por local: a movimentação vale para UM local (local_id; padrão = Central da empresa).
// entrada/saida somam/subtraem do saldo daquele local; ajuste define o saldo DO LOCAL. O total
// (produtos.estoque_atual) é atualizado pela diferença na mesma transação, então a soma dos
// locais sempre fecha com o total. Saldo de local nunca fica negativo. A trava do produto
// (FOR UPDATE) vem primeiro e serializa todas as movimentações do mesmo produto, o que também
// protege as linhas de saldo por local.
//
// `origem` (migration 080) grava de onde veio a movimentação. As regras abaixo valem dentro da mesma
// transação, com o produto já travado, para não haver corrida entre checar e gravar:
// * `bloquearAjusteParaMais`: ajuste que AUMENTA o saldo do local é recusado (AJUSTE_PARA_MAIS_NAO_AUTORIZADO).
//   Os fluxos internos não passam o flag e seguem como antes.
// * `exigirSemHistorico`: só aceita se o produto ainda não tem nenhuma movimentação (ENTRADA_INICIAL_COM_HISTORICO).
//
// `permitirReserva`: o local tipo `reserva` (migration 096) só aceita movimentação de quem passa este sinal, que é
// só o fluxo de pedidos da loja. Movimentação avulsa, transferência e PDV recebem LOCAL_NAO_ENCONTRADO: ninguém
// mexe na Reserva "no braço", o que descasaria o saldo reservado dos pedidos.
async function criarMovimentacao({ produto_id, tipo, quantidade, motivo, usuario_id, empresa_id, local_id, transferencia_id, origem, bloquearAjusteParaMais, exigirSemHistorico, permitirReserva, rastreio }, clienteExterno) {
    const client = clienteExterno || await db.connect();
    const gerenciaTransacao = !clienteExterno;

    try {
        if (gerenciaTransacao) await client.query('BEGIN');

        const { rows: produtoRows } = await client.query(
            'SELECT id, estoque_atual, custo, rastreia_unidade FROM produtos WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
            [produto_id, empresa_id]
        );

        if (!produtoRows.length) {
            if (gerenciaTransacao) await client.query('ROLLBACK');
            return { erro: 'PRODUTO_NAO_ENCONTRADO' };
        }

        // Rastreio por IMEI/série (ADR-008): decide ANTES de mexer no saldo. Violação lança AppError (a transação de quem chama
        // reverte); nunca devolve `erro`, porque vários chamadores ignoram códigos de erro que não conhecem.
        const rastreado = produtoRows[0].rastreia_unidade === true;
        const identificadoresPreparados = prepararRastreio({ rastreado, tipo, quantidade, transferencia_id, rastreio });

        if (exigirSemHistorico) {
            const { rows: historicoRows } = await client.query(
                'SELECT 1 FROM movimentacoes_estoque WHERE produto_id = $1 AND empresa_id = $2 LIMIT 1',
                [produto_id, empresa_id]
            );
            if (historicoRows.length) {
                if (gerenciaTransacao) await client.query('ROLLBACK');
                return { erro: 'ENTRADA_INICIAL_COM_HISTORICO' };
            }
        }

        let localId = local_id;
        if (localId === undefined || localId === null) {
            localId = await garantirLocalCentral(client, empresa_id);
        } else {
            const { rows: localRows } = await client.query(
                `SELECT id FROM locais_estoque WHERE id = $1 AND empresa_id = $2 AND ativo = true
                   AND (tipo <> 'reserva' OR $3::boolean)`,
                [localId, empresa_id, permitirReserva === true]
            );
            if (!localRows.length) {
                if (gerenciaTransacao) await client.query('ROLLBACK');
                return { erro: 'LOCAL_NAO_ENCONTRADO' };
            }
        }

        await client.query(
            `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo)
             VALUES ($1, $2, $3, 0) ON CONFLICT (produto_id, local_id) DO NOTHING`,
            [produto_id, localId, empresa_id]
        );
        const { rows: saldoRows } = await client.query(
            'SELECT saldo FROM estoque_locais WHERE produto_id = $1 AND local_id = $2 AND empresa_id = $3 FOR UPDATE',
            [produto_id, localId, empresa_id]
        );

        const saldoLocal = saldoRows[0].saldo;
        const estoqueAtual = produtoRows[0].estoque_atual;
        let novoSaldoLocal;

        if (tipo === 'entrada') {
            novoSaldoLocal = saldoLocal + quantidade;
        } else if (tipo === 'saida') {
            novoSaldoLocal = saldoLocal - quantidade;
        } else {
            novoSaldoLocal = quantidade;
        }

        if (novoSaldoLocal < 0) {
            if (gerenciaTransacao) await client.query('ROLLBACK');
            return { erro: 'ESTOQUE_INSUFICIENTE' };
        }

        if (bloquearAjusteParaMais && tipo === 'ajuste' && novoSaldoLocal > saldoLocal) {
            if (gerenciaTransacao) await client.query('ROLLBACK');
            return { erro: 'AJUSTE_PARA_MAIS_NAO_AUTORIZADO' };
        }

        const novoEstoque = estoqueAtual + (novoSaldoLocal - saldoLocal);

        await client.query(
            'UPDATE estoque_locais SET saldo = $1, atualizado_em = NOW() WHERE produto_id = $2 AND local_id = $3',
            [novoSaldoLocal, produto_id, localId]
        );
        await client.query('UPDATE produtos SET estoque_atual = $1 WHERE id = $2', [novoEstoque, produto_id]);

        const { rows } = await client.query(
            `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, estoque_resultante, motivo, usuario_id, empresa_id, local_id, saldo_local_resultante, transferencia_id, origem)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [produto_id, tipo, quantidade, novoEstoque, motivo ?? null, usuario_id, empresa_id, localId, novoSaldoLocal, transferencia_id ?? null, origem ?? null]
        );

        if (rastreado) {
            await aplicarRastreio(client, {
                tipo, quantidade, produto_id, empresa_id, usuario_id, rastreio,
                identificadores: identificadoresPreparados, movimentacao: rows[0]
            });
        }

        if (gerenciaTransacao) await client.query('COMMIT');

        return { movimentacao: rows[0], custo: produtoRows[0].custo };

    } catch (error) {
        if (gerenciaTransacao) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (gerenciaTransacao) client.release();
    }
}

// Entrada de estoque inicial EM BLOCO para produtos recém-criados na MESMA transação (importação de lista). Faz o que
// `criarMovimentacao` faria uma a uma (saldo do local, total do produto e movimentação `entrada`/`estoque_inicial`), mas em
// poucas instruções: 2.000 produtos viram ~12 queries em vez de ~16.000. Só vale porque o produto é novo: se algum já tem
// saldo ou qualquer movimentação, recusa tudo (ENTRADA_INICIAL_COM_HISTORICO) e nada é gravado. A soma dos locais continua
// fechando com produtos.estoque_atual. `itens`: [{ produto_id, quantidade, local_id? }] com um item por produto.
const BLOCO_ENTRADA_INICIAL = 500;

async function criarEntradasIniciaisEmLote({ itens, usuario_id, empresa_id }, client) {
    if (!itens.length) return { movimentacoes: 0, unidades: 0 };

    const centralId = itens.some((i) => i.local_id == null) ? await garantirLocalCentral(client, empresa_id) : null;
    const resolvidos = itens.map((i) => ({ ...i, local_id: i.local_id ?? centralId }));

    const locaisPedidos = [...new Set(resolvidos.map((i) => i.local_id))];
    const { rows: locaisOk } = await client.query(
        `SELECT id FROM locais_estoque WHERE id = ANY($1::int[]) AND empresa_id = $2 AND ativo = true AND tipo <> 'reserva'`,
        [locaisPedidos, empresa_id]
    );
    const validos = new Set(locaisOk.map((l) => l.id));
    const invalido = locaisPedidos.find((id) => !validos.has(id));
    if (invalido !== undefined) return { erro: 'LOCAL_NAO_ENCONTRADO', local_id: invalido };

    let unidades = 0;

    for (let i = 0; i < resolvidos.length; i += BLOCO_ENTRADA_INICIAL) {
        const bloco = resolvidos.slice(i, i + BLOCO_ENTRADA_INICIAL);
        const ids = bloco.map((b) => b.produto_id);

        const { rows: comHistorico } = await client.query(
            `SELECT p.id FROM produtos p
             WHERE p.id = ANY($1::int[]) AND p.empresa_id = $2
               AND (p.estoque_atual <> 0
                    OR EXISTS (SELECT 1 FROM movimentacoes_estoque m WHERE m.produto_id = p.id AND m.empresa_id = p.empresa_id)
                    OR EXISTS (SELECT 1 FROM estoque_locais e WHERE e.produto_id = p.id AND e.empresa_id = p.empresa_id))
             LIMIT 1`,
            [ids, empresa_id]
        );
        if (comHistorico.length) return { erro: 'ENTRADA_INICIAL_COM_HISTORICO', produto_id: comHistorico[0].id };

        const { rows: existentes } = await client.query(
            `SELECT COUNT(*)::int AS n FROM produtos WHERE id = ANY($1::int[]) AND empresa_id = $2`,
            [ids, empresa_id]
        );
        if (existentes[0].n !== ids.length) return { erro: 'PRODUTO_NAO_ENCONTRADO' };

        const quantidades = bloco.map((b) => b.quantidade);
        const locais = bloco.map((b) => b.local_id);

        await client.query(
            `INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo)
             SELECT t.produto_id, t.local_id, $1, t.quantidade FROM unnest($2::int[], $3::int[], $4::int[]) AS t(produto_id, local_id, quantidade)`,
            [empresa_id, ids, locais, quantidades]
        );
        await client.query(
            `UPDATE produtos p SET estoque_atual = t.quantidade
             FROM unnest($1::int[], $2::int[]) AS t(produto_id, quantidade)
             WHERE p.id = t.produto_id AND p.empresa_id = $3`,
            [ids, quantidades, empresa_id]
        );
        await client.query(
            `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, estoque_resultante, motivo, usuario_id, empresa_id, local_id, saldo_local_resultante, origem)
             SELECT t.produto_id, 'entrada', t.quantidade, t.quantidade, 'Estoque inicial', $1, $2, t.local_id, t.quantidade, 'estoque_inicial'
             FROM unnest($3::int[], $4::int[], $5::int[]) AS t(produto_id, quantidade, local_id)`,
            [usuario_id, empresa_id, ids, quantidades, locais]
        );

        unidades += quantidades.reduce((a, b) => a + b, 0);
    }

    return { movimentacoes: resolvidos.length, unidades };
}

// Locais ativos da empresa com o saldo do produto em cada um (0 quando nunca teve) e o total.
// `consistente` confere a invariante soma dos locais = produtos.estoque_atual.
async function saldosPorLocal(produto_id, empresa_id) {
    const { rows: produtoRows } = await db.query(
        'SELECT id, estoque_atual FROM produtos WHERE id = $1 AND empresa_id = $2',
        [produto_id, empresa_id]
    );
    if (!produtoRows.length) return null;

    const { rows } = await db.query(
        `SELECT l.id AS local_id, l.tipo, l.nome, l.usuario_id, l.cliente_id, l.ativo,
                COALESCE(el.saldo, 0) AS saldo
         FROM locais_estoque l
         LEFT JOIN estoque_locais el
                ON el.local_id = l.id AND el.empresa_id = l.empresa_id AND el.produto_id = $1
         WHERE l.empresa_id = $2 AND (l.ativo = true OR el.saldo > 0)
         ORDER BY CASE l.tipo WHEN 'central' THEN 0 WHEN 'maleta' THEN 1 WHEN 'consignado' THEN 2 ELSE 3 END, l.nome, l.id`,
        [produto_id, empresa_id]
    );

    const soma = rows.reduce((acc, r) => acc + r.saldo, 0);
    return {
        produto_id,
        estoque_total: produtoRows[0].estoque_atual,
        consistente: soma === produtoRows[0].estoque_atual,
        locais: rows
    };
}

async function listarLocais(empresa_id) {
    const { rows } = await db.query(
        `SELECT id, tipo, nome, usuario_id, cliente_id, ativo
         FROM locais_estoque
         WHERE empresa_id = $1 AND tipo <> 'reserva'
         ORDER BY CASE tipo WHEN 'central' THEN 0 WHEN 'maleta' THEN 1 WHEN 'consignado' THEN 2 ELSE 3 END, nome, id`,
        [empresa_id]
    );
    return rows;
}

async function listarPorProduto(produto_id, empresa_id, { limit, offset }) {
    const { rows } = await db.query(
        `SELECT * FROM movimentacoes_estoque
         WHERE produto_id = $1 AND empresa_id = $2
         ORDER BY criado_em DESC, id DESC
         LIMIT $3 OFFSET $4`,
        [produto_id, empresa_id, limit, offset]
    );

    const { rows: countRows } = await db.query(
        'SELECT COUNT(*) FROM movimentacoes_estoque WHERE produto_id = $1 AND empresa_id = $2',
        [produto_id, empresa_id]
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function getEstoqueBaixo(empresa_id) {
    const { rows } = await db.query(`
        SELECT id, sku, nome, categoria, estoque_atual, estoque_minimo, tipo
        FROM produtos
        WHERE ativo = true
          AND estoque_atual <= estoque_minimo
          AND empresa_id = $1
        ORDER BY (estoque_atual - estoque_minimo) ASC
    `, [empresa_id]);

    return rows;
}


async function listarMovimentacoesRelatorio({ limit, offset, produto_id, data_de, data_ate, empresa_id }) {
    const condicoes = ['m.empresa_id = $1'];
    const valores = [empresa_id];

    if (produto_id !== undefined) {
        valores.push(produto_id);
        condicoes.push('m.produto_id = $' + valores.length);
    }

    if (data_de !== undefined) {
        valores.push(data_de);
        condicoes.push(sqlDiaSP('m.criado_em') + ' >= $' + valores.length);
    }

    if (data_ate !== undefined) {
        valores.push(data_ate);
        condicoes.push(sqlDiaSP('m.criado_em') + ' <= $' + valores.length);
    }

    const where = 'WHERE ' + condicoes.join(' AND ');
    const valoresListagem = [...valores, limit, offset];

    const { rows } = await db.query(
        `SELECT m.*, p.nome AS produto_nome, p.sku AS produto_sku
         FROM movimentacoes_estoque m
         JOIN produtos p ON p.id = m.produto_id AND p.empresa_id = m.empresa_id
         ${where}
         ORDER BY m.criado_em DESC, m.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM movimentacoes_estoque m ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

module.exports = {
    criarMovimentacao,
    criarEntradasIniciaisEmLote,
    garantirLocalCentral,
    garantirLocalTransito,
    garantirLocalReserva,
    saldosPorLocal,
    listarLocais,
    listarPorProduto,
    listarMovimentacoesRelatorio,
    getEstoqueBaixo
};
