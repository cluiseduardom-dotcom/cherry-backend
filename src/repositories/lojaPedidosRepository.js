const crypto = require('node:crypto');
const db = require('../config/db');
const AppError = require('../errors/AppError');
const estoqueRepository = require('./estoqueRepository');
const { RESERVA_MINUTOS, MAX_PEDIDOS_ABERTOS_POR_EMAIL, QUANTIDADE_MAXIMA_EXIBIDA } = require('../constants/loja');

// Pedidos da loja online (visitante): criação com reserva de estoque, idempotência e expiração.
//
// Regras que este arquivo garante, todas dentro de UMA transação por operação:
//  * Preço e disponibilidade são lidos DEPOIS de travar os produtos. O que a cliente viu e o preço que o navegador
//    mandou nunca valem: o servidor grava o preço vigente do canal `online`; se for diferente do exibido, recusa.
//  * Estoque nunca fica negativo: a peça sai do Central para o local Reserva pela mesma função do ERP
//    (estoqueRepository.criarMovimentacao), com o produto travado em ordem de id (mesma ordem do PDV, sem deadlock).
//  * Mesma chave de idempotência + mesmo conteúdo = o mesmo pedido, sem reservar de novo. Mesma chave com conteúdo
//    diferente é recusada. Requisições simultâneas com a mesma chave são serializadas por trava consultiva.
//  * Pedido nunca é apagado: expirado e cancelado continuam no histórico, com trilha de eventos.

function recusar(mensagem, status, codigo, detalhes) {
    const erro = new AppError(mensagem, status);
    erro.codigo = codigo;
    if (detalhes) erro.detalhes = detalhes;
    return erro;
}

const centavos = (valor) => Math.round(Number(valor) * 100);
const reais = (c) => Number((c / 100).toFixed(2));

async function travar(client, chave) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [chave]);
}

async function registrarEvento(client, { empresa_id, pedido_id, tipo, de, para, detalhes }) {
    await client.query(
        `INSERT INTO pedidos_loja_eventos (empresa_id, pedido_id, tipo, status_anterior, status_novo, detalhes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [empresa_id, pedido_id, tipo, de ?? null, para, JSON.stringify(detalhes ?? {})]
    );
}

// O que a cliente pode ver do pedido. Sem e-mail, telefone, id interno, hash nem chave de idempotência.
async function visao(client, empresa_id, filtro) {
    const { rows } = await client.query(
        `SELECT id, codigo, status, subtotal, desconto, frete, total, reserva_expira_em, criado_em, pago_em
           FROM pedidos_loja WHERE empresa_id = $1 AND ${filtro.coluna} = $2`,
        [empresa_id, filtro.valor]
    );

    if (!rows.length) return null;

    const p = rows[0];
    const { rows: itens } = await client.query(
        `SELECT pl.slug, i.nome, i.quantidade, i.preco_unitario
           FROM itens_pedido_loja i
           LEFT JOIN produtos_loja pl ON pl.produto_id = i.produto_id AND pl.empresa_id = i.empresa_id
          WHERE i.pedido_id = $1 AND i.empresa_id = $2
          ORDER BY i.produto_id`,
        [p.id, empresa_id]
    );

    return {
        codigo: p.codigo,
        status: p.status,
        itens: itens.map((i) => ({
            slug: i.slug,
            nome: i.nome,
            quantidade: i.quantidade,
            preco_unitario: Number(i.preco_unitario),
            subtotal: reais(i.quantidade * centavos(i.preco_unitario))
        })),
        subtotal: Number(p.subtotal),
        desconto: Number(p.desconto),
        frete: p.frete === null ? null : Number(p.frete),
        total: Number(p.total),
        reserva_expira_em: p.reserva_expira_em,
        criado_em: p.criado_em,
        pago_em: p.pago_em
    };
}

// Dados de venda lidos com os produtos JÁ TRAVADOS. Preço = o mais recente do canal `online` (regra do PDV).
async function lerDadosDeVenda(client, empresa_id, produtoIds) {
    const { rows } = await client.query(
        `SELECT pl.produto_id, pl.slug, pl.visivel, p.ativo, p.tipo,
                COALESCE(NULLIF(btrim(pl.titulo), ''), p.nome) AS nome,
                (SELECT pp.preco_venda FROM precos_produto pp
                   JOIN canais_venda cv ON cv.id = pp.canal_id AND cv.empresa_id = pp.empresa_id AND cv.nome = 'online' AND cv.ativo = true
                  WHERE pp.produto_id = p.id AND pp.empresa_id = p.empresa_id
                  ORDER BY pp.criado_em DESC, pp.id DESC LIMIT 1) AS preco,
                COALESCE(el.saldo, 0) AS saldo_central
           FROM produtos_loja pl
           JOIN produtos p ON p.id = pl.produto_id AND p.empresa_id = pl.empresa_id
           LEFT JOIN locais_estoque lc ON lc.empresa_id = p.empresa_id AND lc.tipo = 'central'
           LEFT JOIN estoque_locais el ON el.produto_id = p.id AND el.local_id = lc.id AND el.empresa_id = p.empresa_id
          WHERE pl.empresa_id = $1 AND pl.produto_id = ANY($2::int[])`,
        [empresa_id, produtoIds]
    );

    return new Map(rows.map((r) => [r.slug, r]));
}

// Move a peça entre o Central e a Reserva. Duas movimentações comuns no livro; o total do produto não muda.
async function mover(client, { empresa_id, produto_id, quantidade, de, para, motivo }) {
    const base = { produto_id, quantidade, usuario_id: null, empresa_id, motivo, permitirReserva: true };

    const saida = await estoqueRepository.criarMovimentacao({ ...base, tipo: 'saida', local_id: de }, client);
    if (saida.erro) throw recusar('Estoque insuficiente para reservar o pedido', 409, 'ESTOQUE_INSUFICIENTE');

    const entrada = await estoqueRepository.criarMovimentacao({ ...base, tipo: 'entrada', local_id: para }, client);
    if (entrada.erro) throw new Error(`Falha ao gravar a entrada na reserva: ${entrada.erro}`);
}

async function travarProdutos(client, empresa_id, ids) {
    await client.query(
        'SELECT id FROM produtos WHERE empresa_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE',
        [empresa_id, ids]
    );
}

// itens: [{ slug, quantidade, preco_exibido }]; cliente: { nome, email, telefone }.
// Devolve { pedido, reaproveitado }.
async function criarPedido({ empresa_id, chave, hash, cliente, itens }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        await travar(client, `loja:${empresa_id}:${chave}`);

        const { rows: existentes } = await client.query(
            'SELECT id, hash_requisicao FROM pedidos_loja WHERE empresa_id = $1 AND chave_idempotencia = $2',
            [empresa_id, chave]
        );

        if (existentes.length) {
            if (existentes[0].hash_requisicao !== hash) {
                throw recusar('Esta chave de idempotência já foi usada com outro conteúdo', 409, 'CHAVE_REUTILIZADA');
            }

            const pedido = await visao(client, empresa_id, { coluna: 'id', valor: existentes[0].id });
            await client.query('COMMIT');
            return { pedido, reaproveitado: true };
        }

        // Freio contra reserva sem pagamento: poucos pedidos abertos por e-mail. A trava serializa os pedidos do
        // mesmo e-mail (sempre depois da trava da chave, nesta ordem, para nunca haver deadlock).
        await travar(client, `loja-email:${empresa_id}:${cliente.email}`);

        const { rows: abertos } = await client.query(
            `SELECT COUNT(*)::int AS total FROM pedidos_loja
              WHERE empresa_id = $1 AND LOWER(cliente_email) = $2 AND status = 'aguardando_pagamento' AND reserva_expira_em >= NOW()`,
            [empresa_id, cliente.email]
        );

        if (abertos[0].total >= MAX_PEDIDOS_ABERTOS_POR_EMAIL) {
            throw recusar('Você já tem pedidos aguardando pagamento. Conclua ou aguarde expirarem para fazer outro.', 409, 'LIMITE_PEDIDOS_ABERTOS');
        }

        const slugs = itens.map((i) => i.slug);
        const { rows: ids } = await client.query(
            'SELECT produto_id FROM produtos_loja WHERE empresa_id = $1 AND slug = ANY($2::text[])',
            [empresa_id, slugs]
        );

        if (ids.length) await travarProdutos(client, empresa_id, ids.map((r) => r.produto_id));

        const dados = await lerDadosDeVenda(client, empresa_id, ids.map((r) => r.produto_id));

        const problemas = [];
        for (const item of itens) {
            const d = dados.get(item.slug);
            const vendavel = d && d.visivel && d.ativo && d.tipo === 'acabado' && d.preco !== null && Number(d.preco) > 0;

            if (!vendavel) {
                problemas.push({ slug: item.slug, problema: 'indisponivel' });
            } else if (d.saldo_central < item.quantidade) {
                problemas.push({ slug: item.slug, problema: 'estoque_insuficiente', disponivel: Math.min(d.saldo_central, QUANTIDADE_MAXIMA_EXIBIDA) });
            } else if (centavos(d.preco) !== centavos(item.preco_exibido)) {
                problemas.push({ slug: item.slug, problema: 'preco_alterado', preco_atual: Number(d.preco) });
            }
        }

        if (problemas.length) {
            throw recusar('Alguns itens mudaram desde que você os viu. Revise o carrinho.', 409, 'ITENS_ALTERADOS', problemas);
        }

        const linhas = itens
            .map((i) => ({ ...dados.get(i.slug), quantidade: i.quantidade }))
            .sort((a, b) => a.produto_id - b.produto_id);
        const subtotal = linhas.reduce((acc, l) => acc + l.quantidade * centavos(l.preco), 0);
        const codigo = crypto.randomUUID();

        const { rows: criado } = await client.query(
            `INSERT INTO pedidos_loja
                (codigo, empresa_id, cliente_nome, cliente_email, cliente_telefone, chave_idempotencia, hash_requisicao,
                 subtotal, total, reserva_expira_em)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, NOW() + ($9::int * INTERVAL '1 minute'))
             RETURNING id`,
            [codigo, empresa_id, cliente.nome, cliente.email, cliente.telefone ?? null, chave, hash, reais(subtotal), RESERVA_MINUTOS]
        );
        const pedido_id = criado[0].id;

        const centralId = await estoqueRepository.garantirLocalCentral(client, empresa_id);
        const reservaId = await estoqueRepository.garantirLocalReserva(client, empresa_id);

        for (const l of linhas) {
            await client.query(
                `INSERT INTO itens_pedido_loja (pedido_id, produto_id, empresa_id, nome, quantidade, preco_unitario)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [pedido_id, l.produto_id, empresa_id, l.nome, l.quantidade, Number(l.preco)]
            );
            await mover(client, { empresa_id, produto_id: l.produto_id, quantidade: l.quantidade, de: centralId, para: reservaId, motivo: `Reserva online #${pedido_id}` });
        }

        await registrarEvento(client, {
            empresa_id, pedido_id, tipo: 'criado', para: 'aguardando_pagamento',
            detalhes: { itens: linhas.length, total: reais(subtotal), reserva_minutos: RESERVA_MINUTOS }
        });

        const pedido = await visao(client, empresa_id, { coluna: 'id', valor: pedido_id });
        await client.query('COMMIT');
        return { pedido, reaproveitado: false };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Devolve a peça da Reserva ao Central e fecha o pedido (expirado ou cancelado). Chamada com o pedido JÁ travado
// e ainda aguardando pagamento. Reaproveitada pelo cancelamento/pagamento recusado nas próximas fatias.
async function encerrarSemPagamento(client, pedido, { status, motivo }) {
    const { rows: itens } = await client.query(
        'SELECT produto_id, quantidade FROM itens_pedido_loja WHERE pedido_id = $1 AND empresa_id = $2 ORDER BY produto_id',
        [pedido.id, pedido.empresa_id]
    );

    await travarProdutos(client, pedido.empresa_id, itens.map((i) => i.produto_id));

    const centralId = await estoqueRepository.garantirLocalCentral(client, pedido.empresa_id);
    const reservaId = await estoqueRepository.garantirLocalReserva(client, pedido.empresa_id);

    for (const i of itens) {
        await mover(client, {
            empresa_id: pedido.empresa_id, produto_id: i.produto_id, quantidade: i.quantidade,
            de: reservaId, para: centralId, motivo: `Reserva online #${pedido.id} liberada (${motivo})`
        });
    }

    await client.query(
        `UPDATE pedidos_loja SET status = $3, encerrado_em = NOW(), motivo_encerramento = $4, atualizado_em = NOW()
          WHERE id = $1 AND empresa_id = $2 AND status = 'aguardando_pagamento'`,
        [pedido.id, pedido.empresa_id, status, motivo]
    );

    await registrarEvento(client, {
        empresa_id: pedido.empresa_id, pedido_id: pedido.id, tipo: status, de: 'aguardando_pagamento', para: status,
        detalhes: { motivo }
    });
}

// Expira os pedidos com a reserva vencida e devolve as peças ao Central. Uma transação por pedido, com
// FOR UPDATE SKIP LOCKED: rodar o script e a varredura da requisição ao mesmo tempo nunca processa o mesmo pedido
// duas vezes. `empresa_id`/`codigo` são filtros opcionais (a requisição filtra pela própria empresa; o script do
// Render varre todas, usando sempre o empresa_id da própria linha). Devolve quantos expirou.
async function expirarVencidos({ empresa_id = null, codigo = null, limite = 20 } = {}) {
    let expirados = 0;

    while (expirados < limite) {
        const client = await db.connect();

        try {
            await client.query('BEGIN');

            const { rows } = await client.query(
                `SELECT id, empresa_id FROM pedidos_loja
                  WHERE status = 'aguardando_pagamento' AND reserva_expira_em < NOW()
                    AND ($1::int IS NULL OR empresa_id = $1) AND ($2::uuid IS NULL OR codigo = $2::uuid)
                  ORDER BY reserva_expira_em
                  LIMIT 1 FOR UPDATE SKIP LOCKED`,
                [empresa_id, codigo]
            );

            if (!rows.length) {
                await client.query('COMMIT');
                break;
            }

            await encerrarSemPagamento(client, rows[0], { status: 'expirado', motivo: 'reserva_expirada' });
            await client.query('COMMIT');
            expirados += 1;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    return expirados;
}

// Pedido já criado com esta chave e este conteúdo (retry): devolve sem reservar de novo. Usado ANTES da verificação
// anti-robô, porque o token dela é de uso único e o retry de uma cliente que perdeu a resposta não pode ser barrado.
async function buscarReaproveitavel(empresa_id, chave, hash) {
    const { rows } = await db.query(
        'SELECT id FROM pedidos_loja WHERE empresa_id = $1 AND chave_idempotencia = $2 AND hash_requisicao = $3',
        [empresa_id, chave, hash]
    );

    return rows.length ? visao(db, empresa_id, { coluna: 'id', valor: rows[0].id }) : null;
}

async function buscarPedidoPublico(empresa_id, codigo) {
    return visao(db, empresa_id, { coluna: 'codigo', valor: codigo });
}

module.exports = { criarPedido, expirarVencidos, buscarPedidoPublico, buscarReaproveitavel, encerrarSemPagamento };
