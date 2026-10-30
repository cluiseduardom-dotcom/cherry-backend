const db = require('../config/db');
const estoqueRepository = require('./estoqueRepository');
const vendaConsumosRepository = require('./vendaConsumosRepository');
const precosRepository = require('./precosRepository');
const contasReceberRepository = require('./contasReceberRepository');
const pagamentosVendaRepository = require('./pagamentosVendaRepository');
const parcelasPagamentoRepository = require('./parcelasPagamentoRepository');
const estornosPagamentoRepository = require('./estornosPagamentoRepository');
const taxasPlataformaRepository = require('./taxasPlataformaRepository');
const cobrancasPagamentoRepository = require('./cobrancasPagamentoRepository');
const comissoesRepository = require('./comissoesRepository');
const cancelamentosRepository = require('./cancelamentosRepository');
const { executarComLock } = require('./shared/transacoes');
const AppError = require('../errors/AppError');
const { MAX_PARCELAS, MAX_MESES_PRAZO } = require('../constants/limites');
const { inteiroNoIntervalo } = require('../utils/numeros');
const { faixaPorDias, faixaPorCodigo } = require('../constants/cancelamento');

// Usa os getters LOCAIS do Date (não toISOString/UTC) de propósito: a mesma
// armadilha de fuso horário documentada em 006_contas_pagar.sql — o driver pg
// grava uma coluna DATE a partir dos métodos de fuso horário local do Node, e
// meses_prazo é "meses de calendário a partir de hoje", não um intervalo fixo
// de dias. new Date(ano, mes + mesesPrazo, dia) rola o ano corretamente e usa
// o mês calendário real (ex: 31/01 + 1 mês vira 03/03 em ano não bissexto,
// mesmo comportamento de overflow que o JS já aplica em soma de dias).
function calcularDataVencimento(mesesPrazo) {
    return dataComMeses(mesesPrazo);
}

async function getResumo(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          COUNT(*) AS total_vendas,
          COALESCE(SUM(total), 0) AS faturamento,
          COALESCE(AVG(total), 0) AS ticket_medio
        FROM vendas
        WHERE empresa_id = $1 AND status = 'finalizada'
    `, [empresa_id]);
    return rows[0];
}

async function getPorDia(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          DATE(data) AS dia,
          COALESCE(SUM(total), 0) AS faturamento,
          COUNT(*) AS total_vendas
        FROM vendas
        WHERE empresa_id = $1 AND status = 'finalizada'
        GROUP BY DATE(data)
        ORDER BY dia DESC
    `, [empresa_id]);
    return rows;
}

async function getPorMes(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          TO_CHAR(data, 'YYYY-MM') AS mes,
          COALESCE(SUM(total), 0) AS faturamento,
          COUNT(*) AS total_vendas
        FROM vendas
        WHERE empresa_id = $1 AND status = 'finalizada'
        GROUP BY mes
        ORDER BY mes DESC
    `, [empresa_id]);
    return rows;
}

async function getMaisVendidosPeriodo(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          p.id,
          p.nome,
          COALESCE(SUM(iv.quantidade), 0) AS total_vendido
        FROM itens_venda iv
        JOIN produtos p ON p.id = iv.produto_id
        JOIN vendas v ON v.id = iv.venda_id AND v.empresa_id = iv.empresa_id AND v.status = 'finalizada'
        WHERE p.empresa_id = $1
        GROUP BY p.id, p.nome
        ORDER BY total_vendido DESC
        LIMIT 10
    `, [empresa_id]);
    return rows;
}

// Uma única transação cobre a venda inteira: preço de cada item (vindo do
// preço vigente em precos_produto) e a baixa de estoque correspondente
// (reaproveitando estoqueRepository.criarMovimentacao nesta mesma transação).
// custo_unitario também é congelado aqui: vem do mesmo SELECT ... FOR UPDATE
// que já trava o produto pra validar/baixar estoque (estoqueRepository
// retorna `custo` no resultado), não de uma query separada — evita janela
// de inconsistência entre o custo lido e o custo efetivamente vigente no
// instante da baixa. Qualquer falha em qualquer item reverte a venda
// inteira — nada fica parcialmente criado.
function dataComMeses(meses) {
    const hoje = new Date();
    const alvo = new Date(hoje.getFullYear(), hoje.getMonth() + meses, 1);
    const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    const dia = Math.min(hoje.getDate(), ultimoDia);
    return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function dividirEmCentavos(valor, quantidade) {
    const total = Math.round(Number(valor) * 100);
    const base = Math.floor(total / quantidade);
    const resto = total - (base * quantidade);
    return Array.from({ length: quantidade }, (_, index) => (base + (index < resto ? 1 : 0)) / 100);
}

function validarSomaPagamentos(pagamentos, total) {
    const soma = pagamentos.reduce((acc, item) => acc + Math.round(Number(item.valor) * 100), 0);
    return soma === Math.round(Number(total) * 100);
}

// numero_parcelas controla um loop de INSERTs: o teto precisa valer aqui também,
// não só no Zod, para qualquer chamador futuro do repository.
function validarLimitesDeParcelamento(pagamentos, meses_prazo) {
    const mensagemParcelas = `Número de parcelas deve estar entre 1 e ${MAX_PARCELAS}`;
    const mensagemPrazo = `Prazo em meses deve estar entre 1 e ${MAX_MESES_PRAZO}`;

    if (meses_prazo != null) {
        inteiroNoIntervalo(meses_prazo, { min: 1, max: MAX_MESES_PRAZO }, mensagemPrazo);
    }

    for (const pagamento of pagamentos ?? []) {
        if (pagamento.numero_parcelas != null) {
            inteiroNoIntervalo(pagamento.numero_parcelas, { min: 1, max: MAX_PARCELAS }, mensagemParcelas);
        }

        if (pagamento.meses_prazo != null) {
            inteiroNoIntervalo(pagamento.meses_prazo, { min: 1, max: MAX_MESES_PRAZO }, mensagemPrazo);
        }
    }
}

// Local de estoque de onde cada item sai. Sem `local_id`: a Maleta ativa do próprio vendedor, se ele
// tiver uma; senão o Central (comportamento de sempre). Com `local_id`: só o Central ou a PRÓPRIA
// maleta (consignado, maleta alheia e Em trânsito nunca vendem pelo PDV; transferência é outro fluxo).
function criarResolvedorDeLocal(client, { empresa_id, usuario_id }) {
    const cache = new Map();
    let padrao = null;

    async function localPadrao() {
        if (padrao) return padrao;

        const { rows } = await client.query(
            `SELECT id, nome, tipo FROM locais_estoque
             WHERE empresa_id = $1 AND tipo = 'maleta' AND usuario_id = $2 AND ativo = true`,
            [empresa_id, usuario_id]
        );

        if (rows.length) {
            padrao = rows[0];
        } else {
            const centralId = await estoqueRepository.garantirLocalCentral(client, empresa_id);
            padrao = { id: centralId, nome: 'Central', tipo: 'central' };
        }

        return padrao;
    }

    return async function resolver(local_id) {
        if (local_id == null) return localPadrao();
        if (cache.has(local_id)) return cache.get(local_id);

        const { rows } = await client.query(
            'SELECT id, nome, tipo, usuario_id, ativo FROM locais_estoque WHERE id = $1 AND empresa_id = $2',
            [local_id, empresa_id]
        );

        if (!rows.length) throw new AppError('Local de estoque não encontrado', 404);

        const local = rows[0];
        const permitido = local.ativo && (local.tipo === 'central' || (local.tipo === 'maleta' && local.usuario_id === usuario_id));
        if (!permitido) throw new AppError('Você não pode vender a partir deste local de estoque', 403);

        cache.set(local_id, local);
        return local;
    };
}

async function criar({ cliente_id, canal_id, usuario_id, empresa_id, itens, pagamentos, desconto = 0, juros = 0, forma_pagamento, meses_prazo, idempotencyKey = null, somente_clientes_do_usuario }) {
    validarLimitesDeParcelamento(pagamentos, meses_prazo);

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        if (idempotencyKey) {
            const endpoint = 'POST /vendas';
            const { rows: idempotencyRows } = await client.query(
                `INSERT INTO idempotency_keys (empresa_id, usuario_id, chave, endpoint)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (empresa_id, chave, endpoint) DO NOTHING
                 RETURNING id`,
                [empresa_id, usuario_id, idempotencyKey, endpoint]
            );

            if (!idempotencyRows.length) {
                const { rows: existenteRows } = await client.query(
                    `SELECT recurso_id, resposta
                     FROM idempotency_keys
                     WHERE empresa_id = $1 AND chave = $2 AND endpoint = $3
                     FOR UPDATE`,
                    [empresa_id, idempotencyKey, endpoint]
                );

                if (!existenteRows.length || existenteRows[0].resposta == null) {
                    throw new AppError('Operação idempotente já está em processamento ou não possui resposta disponível', 409);
                }

                await client.query('COMMIT');
                return existenteRows[0].resposta;
            }
        }

        if (cliente_id != null) {
            const { rows: clienteRows } = await client.query(
                somente_clientes_do_usuario === undefined
                    ? 'SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2'
                    : 'SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2 AND criado_por = $3',
                somente_clientes_do_usuario === undefined
                    ? [cliente_id, empresa_id]
                    : [cliente_id, empresa_id, somente_clientes_do_usuario]
            );
            if (!clienteRows.length) throw new AppError('Cliente não encontrado', 404);
        }

        const vendaResult = await client.query(
            `INSERT INTO vendas
             (cliente_id, canal_id, usuario_id, subtotal, desconto, juros, total, status, data, empresa_id, forma_pagamento)
             VALUES ($1, $2, $3, 0, $4, $5, 0, 'finalizada', NOW(), $6, $7)
             RETURNING *`,
            [cliente_id ?? null, canal_id, usuario_id, Number(desconto), Number(juros), empresa_id, forma_pagamento ?? 'a_vista']
        );
        const venda = vendaResult.rows[0];

        // Trava os produtos da venda de uma vez, em ordem de id. Duas vendas com os mesmos produtos em
        // ordem diferente travavam uma à outra (deadlock) ao baixar item por item na ordem recebida.
        // Com todos travados nesta ordem global, quem chega depois apenas espera. Existência e
        // ativo continuam sendo validados item a item abaixo.
        //
        // Insumos da ficha de venda (#150 fatia 1b) entram na MESMA trava, na mesma ordem global de id: assim o
        // consumo automático não cria deadlock com outra venda que use os mesmos insumos.
        const produtoIdsVendidos = [...new Set(itens.map((item) => item.produto_id))];
        const fichasVigentes = await vendaConsumosRepository.buscarFichasVigentes(produtoIdsVendidos, empresa_id, client);
        const idsParaTravar = [...new Set([...produtoIdsVendidos, ...fichasVigentes.map((linha) => linha.insumo_produto_id)])];

        await client.query(
            'SELECT id FROM produtos WHERE empresa_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE',
            [empresa_id, idsParaTravar]
        );

        let subtotal = 0;
        const itensProcessados = [];
        const resolverLocal = criarResolvedorDeLocal(client, { empresa_id, usuario_id });

        for (const item of itens) {
            const { rows: produtoRows } = await client.query(
                'SELECT id, ativo FROM produtos WHERE id = $1 AND empresa_id = $2',
                [item.produto_id, empresa_id]
            );

            if (!produtoRows.length) throw new AppError('Produto não encontrado', 404);
            if (!produtoRows[0].ativo) throw new AppError('Produto inativo não pode ser vendido', 400);

            const precoVigente = await precosRepository.buscarPrecoVigente(item.produto_id, canal_id, empresa_id, client);
            if (!precoVigente) throw new AppError('Produto sem preço definido para o canal informado', 409);

            const preco_unitario = Number(precoVigente.preco_venda);
            const local = await resolverLocal(item.local_id);
            const resultado = await estoqueRepository.criarMovimentacao({
                produto_id: item.produto_id,
                tipo: 'saida',
                quantidade: item.quantidade,
                motivo: `Venda #${venda.id}`,
                usuario_id,
                empresa_id,
                local_id: local.id
            }, client);

            if (resultado.erro === 'ESTOQUE_INSUFICIENTE') {
                throw new AppError(
                    local.tipo === 'central'
                        ? 'Estoque insuficiente para essa venda'
                        : `Estoque insuficiente em "${local.nome}" para essa venda. Escolha outro local ou peça uma transferência.`,
                    409
                );
            }
            if (resultado.erro === 'PRODUTO_NAO_ENCONTRADO') throw new AppError('Produto não encontrado', 404);

            itensProcessados.push({
                produto_id: item.produto_id,
                quantidade: item.quantidade,
                preco_unitario,
                custo_unitario: Number(resultado.custo),
                kit_id: item.kit_id ?? null,
                local_id: local.id
            });
            subtotal += item.quantidade * preco_unitario;
        }

        subtotal = Number(subtotal.toFixed(2));
        const descontoFinal = Number(Number(desconto).toFixed(2));
        const jurosFinal = Number(Number(juros).toFixed(2));

        if (descontoFinal > subtotal) {
            throw new AppError('Desconto não pode ser maior que o subtotal', 400);
        }

        const total = Number((subtotal - descontoFinal + jurosFinal).toFixed(2));
        if (total <= 0) throw new AppError('Total da venda deve ser maior que zero', 400);

        const pagamentosEfetivos = (pagamentos ?? [{
            forma_pagamento: forma_pagamento === 'prazo' ? 'crediario' : 'dinheiro',
            valor: total,
            numero_parcelas: 1,
            meses_prazo
        }]).map((pagamento) => ({
            ...pagamento,
            valor: pagamento.valor == null ? total : pagamento.valor
        }));

        if (!validarSomaPagamentos(pagamentosEfetivos, total)) {
            throw new AppError('A soma dos pagamentos deve ser exatamente igual ao total da venda', 400);
        }

        await client.query(
            'UPDATE vendas SET subtotal = $1, desconto = $2, juros = $3, total = $4 WHERE id = $5',
            [subtotal, descontoFinal, jurosFinal, total, venda.id]
        );

        // Taxa interna da plataforma: UMA por venda (aqui, fora do laço de
        // pagamentos), sobre vendas.total já final (subtotal - desconto + juros).
        // Na mesma transação: sem política vigente ou qualquer falha, o ROLLBACK
        // do catch desfaz a venda inteira. Nunca entra na resposta nem nos itens.
        await taxasPlataformaRepository.apurar({ venda_id: venda.id, empresa_id, total }, client);

        // Comissão do vendedor: congelada na mesma transação, sobre subtotal - desconto
        // (sem juros do crediário). Sem percentual configurado para o vendedor, não grava.
        await comissoesRepository.apurar({
            venda_id: venda.id,
            empresa_id,
            usuario_id,
            base: Number((subtotal - descontoFinal).toFixed(2))
        }, client);

        const valores = itensProcessados.map((item) => [
            venda.id, item.produto_id, item.quantidade, item.preco_unitario,
            item.custo_unitario, empresa_id, item.kit_id, item.local_id
        ]);
        const placeholders = valores.map((_, i) => {
            const base = i * 8;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
        }).join(', ');

        const { rows: itensRows } = await client.query(
            `INSERT INTO itens_venda
             (venda_id, produto_id, quantidade, preco_unitario, custo_unitario, empresa_id, kit_id, local_id)
             VALUES ${placeholders} RETURNING *`,
            valores.flat()
        );

        // Baixa automática dos insumos da ficha de venda (só do Central). Falta de saldo não bloqueia a venda:
        // baixa o que existe e deixa a pendência registrada (aparece no sino). Mesma transação da venda.
        await vendaConsumosRepository.registrarConsumosDaVenda({
            venda_id: venda.id,
            itensVendidos: itensProcessados,
            fichas: fichasVigentes,
            usuario_id,
            empresa_id
        }, client);

        // Compatibilidade: chamadas legadas não entram no novo núcleo financeiro.
        // O frontend será migrado para pagamentos[] em etapa própria; enquanto
        // isso não ocorre, preservamos exatamente o comportamento anterior.
        if (pagamentos === undefined) {
            let contaReceber = null;

            if (forma_pagamento === 'prazo') {
                const dataVencimento = dataComMeses(meses_prazo ?? 1);
                contaReceber = await contasReceberRepository.criar({
                    venda_id: venda.id,
                    descricao: `Venda #${venda.id}`,
                    valor: total,
                    data_vencimento: dataVencimento,
                    empresa_id
                }, client);
            }

            // Comissão: venda legada à vista nasce paga (libera); a prazo espera o recebimento.
            await comissoesRepository.recalcularLiberacao({
                venda_id: venda.id, empresa_id, origem: 'venda', executado_por: usuario_id
            }, client);

            await client.query('COMMIT');
            return {
                ...venda,
                subtotal,
                desconto: descontoFinal,
                juros: jurosFinal,
                total,
                itens: itensRows,
                conta_receber: contaReceber,
                pagamentos: []
            };
        }

        const pagamentosCriados = [];
        for (const pagamentoInput of pagamentosEfetivos) {
            const forma = pagamentoInput.forma_pagamento;
            const parcelas = pagamentoInput.numero_parcelas ?? 1;
            const valor = Number(Number(pagamentoInput.valor).toFixed(2));
            const recebido = forma === 'dinheiro'
                ? Number(Number(pagamentoInput.valor_recebido ?? valor).toFixed(2))
                : valor;
            const troco = forma === 'dinheiro' ? Number(Math.max(0, recebido - valor).toFixed(2)) : 0;

            if (forma === 'dinheiro' && recebido < valor) {
                throw new AppError('Valor recebido em dinheiro é inferior ao valor do pagamento', 400);
            }

            const imediato = ['pix', 'dinheiro', 'debito'].includes(forma);
            const status = imediato ? 'pago' : 'pendente';

            // Pix cobrado pelo Mercado Pago: a origem "gateway" só nasce aqui, depois de o backend
            // conferir a cobrança (mesma empresa, paga, mesmo valor, nunca usada). O cliente não a declara.
            const cobranca = pagamentoInput.cobranca_codigo
                ? await cobrancasPagamentoRepository.consumirParaVenda({
                    codigo: pagamentoInput.cobranca_codigo, empresa_id, venda_id: venda.id, valor
                }, client)
                : null;

            const pagamento = await pagamentosVendaRepository.criar({
                venda_id: venda.id,
                empresa_id,
                forma_pagamento: forma,
                valor,
                valor_recebido: recebido,
                troco,
                numero_parcelas: parcelas,
                status,
                origem: cobranca ? 'gateway' : 'manual',
                provedor: cobranca ? cobranca.provedor : null,
                transacao_externa_id: cobranca ? cobranca.id_externo : null,
                usuario_id,
                observacao: pagamentoInput.observacao ?? null
            }, client);

            const valoresParcelas = dividirEmCentavos(valor, parcelas);
            const hoje = new Date();
            const hojeLocal = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

            for (let i = 0; i < parcelas; i++) {
                const numero = i + 1;
                const valorParcela = valoresParcelas[i];
                const crediario = forma === 'crediario';
                const dataVencimento = imediato
                    ? hojeLocal
                    : dataComMeses(crediario ? ((pagamentoInput.meses_prazo ?? 1) * numero) : numero);

                const parcela = await parcelasPagamentoRepository.criar({
                    pagamento_id: pagamento.id,
                    empresa_id,
                    numero,
                    valor: valorParcela,
                    valor_principal: valorParcela,
                    juros: 0,
                    desconto: 0,
                    data_vencimento: dataVencimento,
                    status: imediato ? 'recebida' : 'pendente'
                }, client);

                if (crediario) {
                    await contasReceberRepository.criar({
                        venda_id: venda.id,
                        descricao: `Venda #${venda.id} - Parcela ${numero}/${parcelas}`,
                        valor: valorParcela,
                        data_vencimento: dataVencimento,
                        empresa_id,
                        parcela_id: parcela.id
                    }, client);
                }
            }

            pagamentosCriados.push(pagamento);
        }

        // Comissão: dinheiro recebido pelo vendedor vira repasse a confirmar; o resto do que já
        // entrou como pago (pix, débito) libera a comissão proporcionalmente, já na venda.
        await comissoesRepository.registrarRepasses({
            venda_id: venda.id, empresa_id, vendedor_id: usuario_id, pagamentos: pagamentosCriados
        }, client);

        await comissoesRepository.recalcularLiberacao({
            venda_id: venda.id, empresa_id, origem: 'venda', executado_por: usuario_id
        }, client);

        const pagamentosComParcelas = [];
        for (const pagamento of pagamentosCriados) {
            pagamentosComParcelas.push({
                ...pagamento,
                parcelas: await parcelasPagamentoRepository.listarPorPagamento(pagamento.id, empresa_id, client)
            });
        }

        const resposta = {
            ...venda,
            subtotal,
            desconto: descontoFinal,
            juros: jurosFinal,
            total,
            itens: itensRows,
            pagamentos: pagamentosComParcelas
        };

        if (idempotencyKey) {
            await client.query(
                `UPDATE idempotency_keys
                 SET recurso_id = $1, resposta = $2::jsonb
                 WHERE empresa_id = $3 AND chave = $4 AND endpoint = $5`,
                [venda.id, JSON.stringify(resposta), empresa_id, idempotencyKey, 'POST /vendas']
            );
        }

        await client.query('COMMIT');
        return resposta;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Como a venda foi paga, para a listagem (Histórico): forma e valor de cada pagamento, na ordem em
// que foram lançados. Venda anterior ao módulo de pagamentos não tem linhas: volta [] e a tela usa
// o `forma_pagamento` legado da própria venda. Filtra por empresa_id também aqui.
const SQL_PAGAMENTOS_RESUMO = `COALESCE(
                    (SELECT json_agg(json_build_object('forma_pagamento', pv.forma_pagamento, 'valor', pv.valor::text, 'status', pv.status) ORDER BY pv.id)
                       FROM pagamentos_venda pv WHERE pv.venda_id = v.id AND pv.empresa_id = v.empresa_id),
                    '[]'::json) AS pagamentos`;

async function listarPaginado({ limit, offset, usuario_id, empresa_id, status, canal, data_de, data_ate }) {
    const condicoes = ['v.empresa_id = $1'];
    const valores = [empresa_id];

    if (usuario_id !== undefined) {
        valores.push(usuario_id);
        condicoes.push(`v.usuario_id = $${valores.length}`);
    }

    if (status !== undefined) {
        valores.push(status);
        condicoes.push(`v.status = $${valores.length}`);
    }

    if (canal !== undefined) {
        valores.push(canal);
        condicoes.push(`c.nome = $${valores.length}`);
    }

    if (data_de !== undefined) {
        valores.push(data_de);
        condicoes.push(`v.data::date >= $${valores.length}`);
    }

    if (data_ate !== undefined) {
        valores.push(data_ate);
        condicoes.push(`v.data::date <= $${valores.length}`);
    }

    const where = `WHERE ${condicoes.join(' AND ')}`;

    const valoresListagem = [...valores, limit, offset];
    const { rows } = await db.query(
        `SELECT v.*, c.nome AS canal,
                vend.nome AS vendedor_nome, vf.chave AS vendedor_foto_chave,
                (SELECT COUNT(*)::int FROM itens_venda iv WHERE iv.venda_id = v.id AND iv.empresa_id = v.empresa_id) AS itens_count,
                ${SQL_PAGAMENTOS_RESUMO}
         FROM vendas v
         JOIN canais_venda c ON c.id = v.canal_id
         LEFT JOIN usuarios vend ON vend.id = v.usuario_id AND vend.empresa_id = v.empresa_id
         LEFT JOIN usuarios_fotos vf ON vf.usuario_id = vend.id AND vf.empresa_id = vend.empresa_id
         ${where}
         ORDER BY v.data DESC, v.id DESC
         LIMIT $${valoresListagem.length - 1} OFFSET $${valoresListagem.length}`,
        valoresListagem
    );

    const { rows: countRows } = await db.query(
        `SELECT COUNT(*) FROM vendas v ${where}`,
        valores
    );

    return { items: rows, total: Number(countRows[0].count) };
}

async function buscarPorId(id, empresa_id) {
    const { rows } = await db.query(
        `SELECT v.*, c.nome AS canal,
                vend.nome AS vendedor_nome, vf.chave AS vendedor_foto_chave
         FROM vendas v
         JOIN canais_venda c ON c.id = v.canal_id
         LEFT JOIN usuarios vend ON vend.id = v.usuario_id AND vend.empresa_id = v.empresa_id
         LEFT JOIN usuarios_fotos vf ON vf.usuario_id = vend.id AND vf.empresa_id = vend.empresa_id
         WHERE v.id = $1 AND v.empresa_id = $2`,
        [id, empresa_id]
    );

    if (!rows.length) return null;

    const venda = rows[0];

    const { rows: itensRows } = await db.query(
        'SELECT id, produto_id, quantidade, preco_unitario, custo_unitario, kit_id, local_id FROM itens_venda WHERE venda_id = $1 ORDER BY id',
        [id]
    );

    // Como foi pago: só o que a tela precisa (nunca provedor, NSU, autorização nem dados de gateway).
    const { rows: pagamentosRows } = await db.query(
        `SELECT id, forma_pagamento, valor, valor_recebido, troco, numero_parcelas, status
         FROM pagamentos_venda WHERE venda_id = $1 AND empresa_id = $2 ORDER BY id`,
        [id, empresa_id]
    );

    return { ...venda, itens: itensRows, pagamentos: pagamentosRows };
}

// Estorna o estoque de cada item (entrada auditada, motivo 'cancelamento_venda')
// e marca a venda como cancelada, na mesma transação, gravando o registro imutável
// em cancelamentos_venda. Não reaproveita o
// bloqueio de "produto inativo" do módulo de estoque aqui de propósito: uma
// venda precisa poder ser cancelada mesmo que o produto tenha sido desativado
// depois da venda original. Usa executarComLock direto (não transicionarStatus)
// porque há efeitos colaterais (contasReceberRepository, estoque) entre o
// lock e a escrita final, não um SET estático.
//
// `opcoes` é obrigatório: a política (motivo, faixa autorizada, autorizador) é decidida no
// serviço, e aqui é reconferida SOB O LOCK da venda, para a idade não mudar de faixa entre a
// autorização e a gravação.
//   motivo, login            motivo informado e login de quem cancela
//   faixaAutorizada          código da faixa para a qual o serviço colheu autorização
//   autorizador              { id, login } quando a faixa exige; null na faixa livre
//   restringirAoUsuarioId    quem só enxerga as próprias vendas só cancela as próprias
async function cancelar(id, usuario_id, empresa_id, opcoes) {
    if (!opcoes || !opcoes.motivo || !opcoes.login || !faixaPorCodigo(opcoes.faixaAutorizada)) {
        throw new Error('cancelar: política de cancelamento não informada');
    }

    const { motivo, login, faixaAutorizada, autorizador = null, restringirAoUsuarioId = null } = opcoes;

    return executarComLock('vendas', { coluna: 'id', valor: id }, empresa_id, undefined, async (venda, client) => {
        if (!venda) {
            throw new AppError('Venda não encontrada', 404);
        }

        // Quem não vê as vendas dos outros também não as cancela (404, não confirma o id).
        if (restringirAoUsuarioId !== null && venda.usuario_id !== restringirAoUsuarioId) {
            throw new AppError('Venda não encontrada', 404);
        }

        if (venda.status !== 'finalizada') {
            throw new AppError('Somente vendas finalizadas podem ser canceladas', 409);
        }

        const { dias } = await cancelamentosRepository.buscarIdadeDaVenda(id, empresa_id, client);
        const faixa = faixaPorDias(dias);

        if (faixa.ordem > faixaPorCodigo(faixaAutorizada).ordem) {
            throw new AppError('A idade da venda mudou de faixa durante a autorização. Tente novamente.', 409);
        }

        if (faixa.exige_autorizacao && !autorizador) {
            throw new AppError('Esta venda exige autorização', 403);
        }

        // Checa a conta a receber vinculada antes de mexer em qualquer coisa:
        // se já estiver recebida, bloqueia o cancelamento da venda inteira
        // (o dinheiro já entrou, não faz sentido desfazer a venda por trás
        // dele). Se ainda pendente, cancela junto. Venda à vista nunca gerou
        // conta, e isso é um no-op — mesmo padrão de bloqueio de
        // contasPagarRepository.atualizar (checa e falha antes de escrever).
        await contasReceberRepository.cancelarPorVendaId(id, empresa_id, client);

        // Taxa interna da plataforma: estornada, nunca apagada. Venda histórica
        // sem taxa é no-op.
        await taxasPlataformaRepository.estornarPorVendaId(id, empresa_id, client);

        // Comissão do vendedor: estornada, nunca apagada. Venda sem comissão é no-op.
        await comissoesRepository.estornarPorVendaId(id, empresa_id, client);

        const { rows: pagamentosRows } = await client.query(
            `SELECT * FROM pagamentos_venda WHERE venda_id = $1 AND empresa_id = $2 FOR UPDATE`,
            [id, empresa_id]
        );

        // Valor devolvido = soma dos estornos gerados por este cancelamento. Venda legada à vista,
        // que nunca teve pagamentos_venda, devolve o total.
        let valorDevolvido = 0;

        for (const pagamento of pagamentosRows) {
            const { rows: estornosRows } = await client.query(
                `SELECT COALESCE(SUM(valor), 0) AS total_estornado
                 FROM estornos_pagamento WHERE pagamento_id = $1 AND empresa_id = $2`,
                [pagamento.id, empresa_id]
            );

            const totalEstornado = Number(estornosRows[0].total_estornado);
            const saldoEstorno = Number((Number(pagamento.valor) - totalEstornado).toFixed(2));

            if (saldoEstorno > 0 && pagamento.status !== 'cancelado') {
                await estornosPagamentoRepository.criar({
                    pagamento_id: pagamento.id,
                    empresa_id,
                    valor: saldoEstorno,
                    motivo: `Estorno automático pelo cancelamento da venda #${id}`,
                    usuario_id
                }, client);

                valorDevolvido = Number((valorDevolvido + saldoEstorno).toFixed(2));
            }

            await client.query(
                `UPDATE pagamentos_venda
                 SET status = 'estornado', atualizado_em = NOW()
                 WHERE id = $1 AND empresa_id = $2`,
                [pagamento.id, empresa_id]
            );

            await client.query(
                `UPDATE parcelas_pagamento
                 SET status = CASE WHEN status = 'recebida' THEN 'estornada' ELSE 'cancelada' END,
                     atualizado_em = NOW()
                 WHERE pagamento_id = $1 AND empresa_id = $2
                   AND status NOT IN ('estornada','cancelada')`,
                [pagamento.id, empresa_id]
            );
        }

        if (pagamentosRows.length === 0 && venda.forma_pagamento === 'a_vista') {
            valorDevolvido = Number(Number(venda.total).toFixed(2));
        }

        const { rows: itensRows } = await client.query(
            'SELECT produto_id, quantidade, local_id FROM itens_venda WHERE venda_id = $1 AND empresa_id = $2 ORDER BY produto_id, id',
            [id, empresa_id]
        );

        let quantidadeDevolvida = 0;

        for (const item of itensRows) {
            await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.produto_id,
                    tipo: 'entrada',
                    quantidade: item.quantidade,
                    motivo: 'cancelamento_venda',
                    usuario_id,
                    empresa_id,
                    // Volta ao local de onde saiu (Maleta ou Central), não a um local qualquer.
                    local_id: item.local_id
                },
                client
            );

            quantidadeDevolvida += item.quantidade;
        }

        // Insumos consumidos pela venda (ficha de venda) voltam ao Central; pendências dessa venda se encerram.
        await vendaConsumosRepository.devolverConsumosDaVenda({ venda_id: id, usuario_id, empresa_id }, client);

        const { rows: atualizadaRows } = await client.query(
            `UPDATE vendas SET status = 'cancelada' WHERE id = $1 AND empresa_id = $2 RETURNING *`,
            [id, empresa_id]
        );

        const cancelamento = await cancelamentosRepository.inserir({
            empresa_id,
            venda_id: id,
            motivo,
            cancelado_por: usuario_id,
            cancelado_por_login: login,
            autorizado_por: autorizador ? autorizador.id : null,
            autorizado_por_login: autorizador ? autorizador.login : null,
            faixa_aplicada: faixa.codigo,
            dias_da_venda: dias,
            quantidade_devolvida: quantidadeDevolvida,
            valor_devolvido: valorDevolvido
        }, client);

        return { ...atualizadaRows[0], cancelamento };
    });
}

module.exports = {
    getResumo,
    getPorDia,
    getPorMes,
    getMaisVendidosPeriodo,
    criar,
    listarPaginado,
    buscarPorId,
    cancelar
};
