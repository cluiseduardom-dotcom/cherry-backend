const crypto = require('node:crypto');
const db = require('../config/db');
const AppError = require('../errors/AppError');
const estoqueRepository = require('./estoqueRepository');
const vendasRepository = require('./vendasRepository');
const { RESERVA_MINUTOS, MAX_PEDIDOS_ABERTOS_POR_EMAIL, QUANTIDADE_MAXIMA_EXIBIDA, RESERVA_TETO_MINUTOS, RESERVA_GRACA_MINUTOS, PREPARO_PAGAMENTO_SEGUNDOS } = require('../constants/loja');

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

    // Pagamento em aberto (para a cliente voltar à tela e ainda ver o QR do Pix ou o link do cartão). Só enquanto o
    // pedido aguarda pagamento e a cobrança está pendente; nunca traz taxa, id do provedor nem dado do pagador.
    const { rows: cobrancas } = p.status === 'aguardando_pagamento' ? await client.query(
        `SELECT c.metodo, c.status, c.qr_code, c.qr_code_base64, c.link_url, c.parcelas_maximas, c.expira_em
           FROM pedidos_loja p JOIN cobrancas_pagamento c ON c.codigo = p.cobranca_codigo AND c.empresa_id = p.empresa_id
          WHERE p.id = $1 AND p.empresa_id = $2`,
        [p.id, empresa_id]
    ) : { rows: [] };
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
        pago_em: p.pago_em,
        pagamento: cobrancas.length && cobrancas[0].status === 'pendente' ? resumoDoPagamento(cobrancas[0]) : null
    };
}

// O que a cliente vê de um pagamento em aberto. Pix: copia-e-cola e QR. Cartão: o link da página do Mercado Pago.
function resumoDoPagamento(c) {
    const alvo = c.expira_em ? new Date(c.expira_em).getTime() : null;
    const base = {
        metodo: c.metodo === 'cartao_link' ? 'cartao' : 'pix',
        status: c.status,
        expira_em: c.expira_em ?? null,
        expira_em_segundos: alvo === null ? null : Math.max(0, Math.floor((alvo - Date.now()) / 1000))
    };

    return c.metodo === 'cartao_link'
        ? { ...base, link_url: c.link_url, parcelas_maximas: c.parcelas_maximas }
        : { ...base, qr_code: c.qr_code, qr_code_base64: c.qr_code_base64 };
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
                    -- Pedido cuja cobrança já foi PAGA mas ainda não virou venda nunca expira: espera a conversão.
                    AND NOT EXISTS (SELECT 1 FROM cobrancas_pagamento c
                                     WHERE c.codigo = pedidos_loja.cobranca_codigo AND c.empresa_id = pedidos_loja.empresa_id AND c.status = 'pago')
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


// ---------------------------------------------------------------------------------------------------------------
// Pagamento
// ---------------------------------------------------------------------------------------------------------------

const METODO_DA_COBRANCA = { pix: 'pix', cartao: 'cartao_link' };

// Decide, sob a trava da linha do pedido, o que fazer com o pedido de pagamento da cliente:
//  * 'reutilizar': já existe cobrança em aberto do mesmo método (a cliente voltou à tela ou clicou duas vezes);
//  * 'criar': grava no pedido o código da cobrança NOVA antes de chamar o provedor. Duas requisições simultâneas
//    nunca criam duas cobranças: a segunda vê o código já gravado e espera ("em preparo").
// Recusas: pedido de outra loja/inexistente (404); pedido pago, expirado, cancelado ou sem reserva (409); cobrança
// em aberto com OUTRO método (409: trocar de método com um Pix válido no ar poderia gerar dois pagamentos).
async function prepararPagamento({ empresa_id, codigo, metodo }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT * FROM pedidos_loja WHERE empresa_id = $1 AND codigo = $2 FOR UPDATE',
            [empresa_id, codigo]
        );

        if (!rows.length) throw new AppError('Pedido não encontrado', 404);

        const pedido = rows[0];

        if (pedido.status === 'pago') throw recusar('Este pedido já foi pago.', 409, 'PEDIDO_JA_PAGO');

        if (pedido.status !== 'aguardando_pagamento') {
            throw recusar('Este pedido não está mais aguardando pagamento. Faça um novo pedido.', 409, 'PEDIDO_ENCERRADO');
        }

        if (new Date(pedido.reserva_expira_em).getTime() < Date.now()) {
            throw recusar('O prazo de reserva deste pedido terminou. Faça um novo pedido.', 409, 'RESERVA_EXPIRADA');
        }

        if (pedido.cobranca_codigo) {
            const { rows: cobrancas } = await client.query(
                `SELECT codigo, metodo, status, expira_em, qr_code, link_url,
                        EXTRACT(EPOCH FROM (NOW() - criado_em)) AS idade_segundos
                   FROM cobrancas_pagamento WHERE codigo = $1 AND empresa_id = $2`,
                [pedido.cobranca_codigo, empresa_id]
            );
            const cobranca = cobrancas[0];

            if (!cobranca) {
                // Código gravado e cobrança ainda sem linha: outra requisição a está criando agora. Passado o prazo,
                // considera abandonada (a requisição que a gravou caiu antes de criar) e deixa criar de novo.
                const idadeSegundos = (Date.now() - new Date(pedido.atualizado_em).getTime()) / 1000;

                if (idadeSegundos < PREPARO_PAGAMENTO_SEGUNDOS) {
                    throw recusar('O pagamento deste pedido está sendo preparado. Tente novamente em instantes.', 409, 'PAGAMENTO_EM_PREPARO');
                }
            } else if (cobranca.status === 'pago') {
                throw recusar('O pagamento deste pedido já foi recebido e está sendo confirmado.', 409, 'PEDIDO_JA_PAGO');
            } else if (cobranca.status === 'pendente' && (!cobranca.expira_em || new Date(cobranca.expira_em).getTime() > Date.now())) {
                // Cobrança criada, mas o provedor ainda não respondeu (sem QR nem link): está em preparo agora. Reutilizá-la
                // devolveria um pagamento vazio à cliente. Se ficou assim por mais que o prazo, a criação morreu: cria outra
                // (a antiga não tem id no provedor, então nunca pode ser paga).
                const semDadosDoProvedor = cobranca.metodo === 'pix' ? !cobranca.qr_code : !cobranca.link_url;

                if (semDadosDoProvedor) {
                    if (Number(cobranca.idade_segundos) < PREPARO_PAGAMENTO_SEGUNDOS) {
                        throw recusar('O pagamento deste pedido está sendo preparado. Tente novamente em instantes.', 409, 'PAGAMENTO_EM_PREPARO');
                    }
                } else {
                    if (cobranca.metodo !== METODO_DA_COBRANCA[metodo]) {
                        throw recusar('Já existe um pagamento em aberto com outro método. Conclua-o ou aguarde ele expirar.', 409, 'PAGAMENTO_OUTRO_METODO');
                    }

                    await client.query('COMMIT');
                    return { acao: 'reutilizar', pedido, cobrancaCodigo: cobranca.codigo };
                }
            }
        }

        const novoCodigo = crypto.randomUUID();

        await client.query(
            'UPDATE pedidos_loja SET cobranca_codigo = $3, atualizado_em = NOW() WHERE id = $1 AND empresa_id = $2',
            [pedido.id, empresa_id, novoCodigo]
        );
        await client.query('COMMIT');

        return { acao: 'criar', pedido, cobrancaCodigo: novoCodigo };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// A criação da cobrança falhou antes de existir linha dela (ex.: loja sem Mercado Pago conectado): solta o código
// gravado para a cliente poder tentar de novo na hora. Se a cobrança chegou a existir (e ficou 'falhou'), não mexe.
async function liberarPagamentoNaoCriado({ empresa_id, pedido_id, cobrancaCodigo }) {
    await db.query(
        `UPDATE pedidos_loja SET cobranca_codigo = NULL, atualizado_em = NOW()
          WHERE id = $1 AND empresa_id = $2 AND cobranca_codigo = $3
            AND NOT EXISTS (SELECT 1 FROM cobrancas_pagamento c WHERE c.codigo = $3 AND c.empresa_id = $2)`,
        [pedido_id, empresa_id, cobrancaCodigo]
    );
}

// Pagamento iniciado: dá tempo de a cliente pagar (prazo da reserva + uma folga curta), com teto absoluto contado
// da criação do pedido. O teto impede segurar a peça para sempre criando cobrança atrás de cobrança.
async function estenderReserva({ empresa_id, pedido_id, cobrancaCodigo, metodo }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `UPDATE pedidos_loja
                SET reserva_expira_em = LEAST(
                        criado_em + ($3::int * INTERVAL '1 minute'),
                        GREATEST(reserva_expira_em, NOW() + (($4::int + $5::int) * INTERVAL '1 minute'))),
                    atualizado_em = NOW()
              WHERE id = $1 AND empresa_id = $2 AND status = 'aguardando_pagamento'
              RETURNING reserva_expira_em`,
            [pedido_id, empresa_id, RESERVA_TETO_MINUTOS, RESERVA_MINUTOS, RESERVA_GRACA_MINUTOS]
        );

        if (rows.length) {
            await registrarEvento(client, {
                empresa_id, pedido_id, tipo: 'pagamento_iniciado', de: 'aguardando_pagamento', para: 'aguardando_pagamento',
                detalhes: { metodo, cobranca: cobrancaCodigo }
            });
        }

        await client.query('COMMIT');
        return rows[0]?.reserva_expira_em ?? null;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Pedido pago -> venda
// ---------------------------------------------------------------------------------------------------------------

// Converte o pedido cuja cobrança foi PAGA em uma venda do Vertumno, em UMA transação: devolve a peça da Reserva ao
// Central, cria a venda (canal `online`, preço CONGELADO do pedido, pagamento do gateway, taxa da plataforma como no
// PDV) e marca o pedido pago. Qualquer falha desfaz tudo: o pedido segue aguardando, a peça segue reservada e a
// próxima tentativa (webhook repetido, consulta ou o cron) refaz.
//
// Idempotente: sob a trava do pedido, pedido já pago não vende de novo (webhook duplicado, simultâneo ou repetido).
// Pagamento tardio (pedido já expirado): se ainda houver estoque no Central, vende; se não houver, NÃO vende, registra
// o evento e a cobrança paga continua sem venda, aparecendo em "a devolver" para o financeiro estornar.
// Devolve null se a cobrança não é de pedido da loja; senão { resultado, pedido_id, venda_id? }.
async function converterPedidoPago(cobranca) {
    const client = await db.connect();
    let pedido = null;

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT * FROM pedidos_loja WHERE empresa_id = $1 AND cobranca_codigo = $2 FOR UPDATE',
            [cobranca.empresa_id, cobranca.codigo]
        );

        if (!rows.length) {
            await client.query('COMMIT');
            return null;
        }

        pedido = rows[0];
        const empresa_id = pedido.empresa_id;

        if (pedido.status === 'pago') {
            await client.query('COMMIT');
            return { resultado: 'ja_convertido', pedido_id: pedido.id, venda_id: pedido.venda_id };
        }

        if (pedido.status === 'cancelado') {
            await registrarEvento(client, { empresa_id, pedido_id: pedido.id, tipo: 'pago_em_pedido_cancelado', de: pedido.status, para: pedido.status, detalhes: { cobranca: cobranca.codigo } });
            await client.query('COMMIT');
            return { resultado: 'pedido_cancelado', pedido_id: pedido.id };
        }

        // Estado atual da cobrança, não o objeto recebido (pode estar velho): precisa estar paga e sem venda.
        const { rows: atuais } = await client.query(
            'SELECT metodo, status, valor, tipo_cartao, parcelas, venda_id FROM cobrancas_pagamento WHERE codigo = $1 AND empresa_id = $2',
            [cobranca.codigo, empresa_id]
        );
        const cob = atuais[0];

        if (!cob || cob.status !== 'pago' || cob.venda_id !== null) {
            await client.query('COMMIT');
            return { resultado: 'cobranca_indisponivel', pedido_id: pedido.id };
        }

        if (centavos(cob.valor) !== centavos(pedido.total)) {
            throw new Error('Valor da cobrança paga não confere com o total do pedido');
        }

        const { rows: itens } = await client.query(
            'SELECT produto_id, quantidade, preco_unitario FROM itens_pedido_loja WHERE pedido_id = $1 AND empresa_id = $2 ORDER BY produto_id',
            [pedido.id, empresa_id]
        );

        await travarProdutos(client, empresa_id, itens.map((i) => i.produto_id));

        const centralId = await estoqueRepository.garantirLocalCentral(client, empresa_id);
        const reservaId = await estoqueRepository.garantirLocalReserva(client, empresa_id);

        if (pedido.status === 'aguardando_pagamento') {
            // A peça está na Reserva: volta ao Central e a venda a baixa de lá, na mesma transação (nunca há instante
            // em que ela esteja livre para o PDV).
            for (const i of itens) {
                await mover(client, {
                    empresa_id, produto_id: i.produto_id, quantidade: i.quantidade, de: reservaId, para: centralId,
                    motivo: `Reserva online #${pedido.id} (pagamento confirmado)`
                });
            }
        } else {
            // Pedido expirado: a reserva já voltou ao Central. Só vende se ainda houver saldo para tudo.
            const { rows: saldos } = await client.query(
                'SELECT produto_id, saldo FROM estoque_locais WHERE empresa_id = $1 AND local_id = $2 AND produto_id = ANY($3::int[])',
                [empresa_id, centralId, itens.map((i) => i.produto_id)]
            );
            const saldoPor = new Map(saldos.map((r) => [r.produto_id, r.saldo]));

            if (itens.some((i) => (saldoPor.get(i.produto_id) ?? 0) < i.quantidade)) {
                await registrarEvento(client, { empresa_id, pedido_id: pedido.id, tipo: 'pago_sem_estoque', de: pedido.status, para: pedido.status, detalhes: { cobranca: cobranca.codigo, motivo: 'pagamento chegou depois de a reserva expirar e a peça não está mais disponível; estornar' } });
                await client.query('COMMIT');
                return { resultado: 'pago_sem_estoque', pedido_id: pedido.id };
            }
        }

        const { rows: canais } = await client.query(
            `SELECT id FROM canais_venda WHERE empresa_id = $1 AND nome = 'online' AND ativo = true`,
            [empresa_id]
        );

        if (!canais.length) throw new Error('Empresa sem o canal de venda "online" ativo');

        const pagamento = cob.metodo === 'pix'
            ? { forma_pagamento: 'pix', valor: Number(pedido.total), cobranca_codigo: cobranca.codigo }
            : { forma_pagamento: cob.tipo_cartao, valor: Number(pedido.total), numero_parcelas: cob.parcelas ?? 1, cobranca_codigo: cobranca.codigo };

        if (!pagamento.forma_pagamento) throw new Error('Cobrança de cartão paga sem o tipo do cartão');

        const venda = await vendasRepository.criar({
            canal_id: canais[0].id,
            usuario_id: null,
            empresa_id,
            itens: itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade })),
            pagamentos: [pagamento],
            clienteExterno: client,
            precosFixos: Object.fromEntries(itens.map((i) => [i.produto_id, Number(i.preco_unitario)]))
        });

        await client.query(
            `UPDATE pedidos_loja
                SET status = 'pago', pago_em = NOW(), venda_id = $3, encerrado_em = NULL, motivo_encerramento = NULL, atualizado_em = NOW()
              WHERE id = $1 AND empresa_id = $2`,
            [pedido.id, empresa_id, venda.id]
        );
        await registrarEvento(client, {
            empresa_id, pedido_id: pedido.id, tipo: 'pago', de: pedido.status, para: 'pago',
            detalhes: { venda_id: venda.id, metodo: cob.metodo, apos_expirar: pedido.status === 'expirado' }
        });

        await client.query('COMMIT');
        return { resultado: 'convertido', pedido_id: pedido.id, venda_id: venda.id };
    } catch (error) {
        await client.query('ROLLBACK');

        // Rastro da falha, fora da transação desfeita (só texto curto do erro, nunca dado da cliente).
        if (pedido) {
            await db.query(
                `INSERT INTO pedidos_loja_eventos (empresa_id, pedido_id, tipo, status_anterior, status_novo, detalhes)
                 VALUES ($1, $2, 'conversao_falhou', $3, $3, $4)`,
                [pedido.empresa_id, pedido.id, pedido.status, JSON.stringify({ erro: String(error.message).slice(0, 200) })]
            ).catch(() => {});
        }

        throw error;
    } finally {
        client.release();
    }
}

// Rede de segurança (roda no cron): pedidos aguardando cuja cobrança já está paga e ainda sem venda, por exemplo
// porque a conversão falhou na hora do webhook. Cada um é tentado sozinho; uma falha não impede os outros.
async function converterPendentes({ limite = 50 } = {}) {
    const { rows } = await db.query(
        `SELECT c.* FROM pedidos_loja p
           JOIN cobrancas_pagamento c ON c.codigo = p.cobranca_codigo AND c.empresa_id = p.empresa_id
          WHERE p.status = 'aguardando_pagamento' AND c.status = 'pago' AND c.venda_id IS NULL
          ORDER BY p.id LIMIT $1`,
        [limite]
    );

    let convertidos = 0;

    for (const cobranca of rows) {
        try {
            const r = await converterPedidoPago(cobranca);
            if (r?.resultado === 'convertido') convertidos += 1;
        } catch (error) {
            console.error(`Falha ao converter o pedido da cobrança ${cobranca.codigo}: ${error.message}`);
        }
    }

    return convertidos;
}

module.exports = {
    criarPedido, expirarVencidos, buscarPedidoPublico, buscarReaproveitavel, encerrarSemPagamento,
    prepararPagamento, liberarPagamentoNaoCriado, estenderReserva, converterPedidoPago, converterPendentes
};
