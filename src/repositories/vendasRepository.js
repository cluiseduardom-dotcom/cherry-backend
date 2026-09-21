const db = require('../config/db');
const estoqueRepository = require('./estoqueRepository');
const precosRepository = require('./precosRepository');
const contasReceberRepository = require('./contasReceberRepository');
const pagamentosVendaRepository = require('./pagamentosVendaRepository');
const parcelasPagamentoRepository = require('./parcelasPagamentoRepository');
const estornosPagamentoRepository = require('./estornosPagamentoRepository');
const { executarComLock } = require('./shared/transacoes');
const AppError = require('../errors/AppError');

// Usa os getters LOCAIS do Date (não toISOString/UTC) de propósito: a mesma
// armadilha de fuso horário documentada em 006_contas_pagar.sql — o driver pg
// grava uma coluna DATE a partir dos métodos de fuso horário local do Node, e
// meses_prazo é "meses de calendário a partir de hoje", não um intervalo fixo
// de dias. new Date(ano, mes + mesesPrazo, dia) rola o ano corretamente e usa
// o mês calendário real (ex: 31/01 + 1 mês vira 03/03 em ano não bissexto,
// mesmo comportamento de overflow que o JS já aplica em soma de dias).
function calcularDataVencimento(mesesPrazo) {
    const hoje = new Date();
    const vencimento = new Date(hoje.getFullYear(), hoje.getMonth() + mesesPrazo, hoje.getDate());

    const ano = vencimento.getFullYear();
    const mes = String(vencimento.getMonth() + 1).padStart(2, '0');
    const dia = String(vencimento.getDate()).padStart(2, '0');

    return `${ano}-${mes}-${dia}`;
}

async function getResumo(empresa_id) {
    const { rows } = await db.query(`
        SELECT
          COUNT(*) AS total_vendas,
          COALESCE(SUM(total), 0) AS faturamento,
          COALESCE(AVG(total), 0) AS ticket_medio
        FROM vendas
        WHERE empresa_id = $1
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
        WHERE empresa_id = $1
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
        WHERE empresa_id = $1
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

async function criar({ cliente_id, canal_id, usuario_id, empresa_id, itens, pagamentos, desconto = 0, juros = 0, forma_pagamento, meses_prazo }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        if (cliente_id != null) {
            const { rows: clienteRows } = await client.query(
                'SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2',
                [cliente_id, empresa_id]
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

        let subtotal = 0;
        const itensProcessados = [];

        for (const item of itens) {
            const { rows: produtoRows } = await client.query(
                'SELECT id, ativo FROM produtos WHERE id = $1 AND empresa_id = $2',
                [item.produto_id, empresa_id]
            );

            if (!produtoRows.length) throw new AppError('Produto não encontrado', 404);
            if (!produtoRows[0].ativo) throw new AppError('Produto inativo não pode ser vendido', 400);

            const precoVigente = await precosRepository.buscarPrecoVigente(item.produto_id, canal_id, empresa_id);
            if (!precoVigente) throw new AppError('Produto sem preço definido para o canal informado', 409);

            const preco_unitario = Number(precoVigente.preco_venda);
            const resultado = await estoqueRepository.criarMovimentacao({
                produto_id: item.produto_id,
                tipo: 'saida',
                quantidade: item.quantidade,
                motivo: `Venda #${venda.id}`,
                usuario_id,
                empresa_id
            }, client);

            if (resultado.erro === 'ESTOQUE_INSUFICIENTE') throw new AppError('Estoque insuficiente para essa venda', 409);
            if (resultado.erro === 'PRODUTO_NAO_ENCONTRADO') throw new AppError('Produto não encontrado', 404);

            itensProcessados.push({
                produto_id: item.produto_id,
                quantidade: item.quantidade,
                preco_unitario,
                custo_unitario: Number(resultado.custo),
                kit_id: item.kit_id ?? null
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

        const valores = itensProcessados.map((item) => [
            venda.id, item.produto_id, item.quantidade, item.preco_unitario,
            item.custo_unitario, empresa_id, item.kit_id
        ]);
        const placeholders = valores.map((_, i) => {
            const base = i * 7;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
        }).join(', ');

        const { rows: itensRows } = await client.query(
            `INSERT INTO itens_venda
             (venda_id, produto_id, quantidade, preco_unitario, custo_unitario, empresa_id, kit_id)
             VALUES ${placeholders} RETURNING *`,
            valores.flat()
        );

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

            const pagamento = await pagamentosVendaRepository.criar({
                venda_id: venda.id,
                empresa_id,
                forma_pagamento: forma,
                valor,
                valor_recebido: recebido,
                troco,
                numero_parcelas: parcelas,
                status,
                origem: 'manual',
                usuario_id,
                observacao: pagamentoInput.observacao ?? null
            }, client);

            const valoresParcelas = dividirEmCentavos(valor, parcelas);
            const hoje = new Date();

            for (let i = 0; i < parcelas; i++) {
                const numero = i + 1;
                const valorParcela = valoresParcelas[i];
                const crediario = forma === 'crediario';
                const dataVencimento = imediato
                    ? hoje.toISOString().slice(0, 10)
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

        await client.query('COMMIT');

        const pagamentosComParcelas = [];
        for (const pagamento of pagamentosCriados) {
            pagamentosComParcelas.push({
                ...pagamento,
                parcelas: await parcelasPagamentoRepository.listarPorPagamento(pagamento.id, empresa_id)
            });
        }

        return {
            ...venda,
            subtotal,
            desconto: descontoFinal,
            juros: jurosFinal,
            total,
            itens: itensRows,
            pagamentos: pagamentosComParcelas
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

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
                (SELECT COUNT(*)::int FROM itens_venda iv WHERE iv.venda_id = v.id AND iv.empresa_id = v.empresa_id) AS itens_count
         FROM vendas v
         JOIN canais_venda c ON c.id = v.canal_id
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
        `SELECT v.*, c.nome AS canal
         FROM vendas v
         JOIN canais_venda c ON c.id = v.canal_id
         WHERE v.id = $1 AND v.empresa_id = $2`,
        [id, empresa_id]
    );

    if (!rows.length) return null;

    const venda = rows[0];

    const { rows: itensRows } = await db.query(
        'SELECT id, produto_id, quantidade, preco_unitario, custo_unitario, kit_id FROM itens_venda WHERE venda_id = $1 ORDER BY id',
        [id]
    );

    return { ...venda, itens: itensRows };
}

// Estorna o estoque de cada item (entrada auditada, motivo 'cancelamento_venda')
// e marca a venda como cancelada, na mesma transação. Não reaproveita o
// bloqueio de "produto inativo" do módulo de estoque aqui de propósito: uma
// venda precisa poder ser cancelada mesmo que o produto tenha sido desativado
// depois da venda original. Usa executarComLock direto (não transicionarStatus)
// porque há efeitos colaterais (contasReceberRepository, estoque) entre o
// lock e a escrita final, não um SET estático.
async function cancelar(id, usuario_id, empresa_id) {
    return executarComLock('vendas', { coluna: 'id', valor: id }, empresa_id, undefined, async (venda, client) => {
        if (!venda) {
            throw new AppError('Venda não encontrada', 404);
        }

        if (venda.status !== 'finalizada') {
            throw new AppError('Somente vendas finalizadas podem ser canceladas', 409);
        }

        // Checa a conta a receber vinculada antes de mexer em qualquer coisa:
        // se já estiver recebida, bloqueia o cancelamento da venda inteira
        // (o dinheiro já entrou, não faz sentido desfazer a venda por trás
        // dele). Se ainda pendente, cancela junto. Venda à vista nunca gerou
        // conta, e isso é um no-op — mesmo padrão de bloqueio de
        // contasPagarRepository.atualizar (checa e falha antes de escrever).
        await contasReceberRepository.cancelarPorVendaId(id, empresa_id, client);

        const { rows: pagamentosRows } = await client.query(
            `SELECT * FROM pagamentos_venda WHERE venda_id = $1 AND empresa_id = $2 FOR UPDATE`,
            [id, empresa_id]
        );

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

        const { rows: itensRows } = await client.query(
            'SELECT produto_id, quantidade FROM itens_venda WHERE venda_id = $1',
            [id]
        );

        for (const item of itensRows) {
            await estoqueRepository.criarMovimentacao(
                {
                    produto_id: item.produto_id,
                    tipo: 'entrada',
                    quantidade: item.quantidade,
                    motivo: 'cancelamento_venda',
                    usuario_id,
                    empresa_id
                },
                client
            );
        }

        const { rows: atualizadaRows } = await client.query(
            `UPDATE vendas SET status = 'cancelada' WHERE id = $1 RETURNING *`,
            [id]
        );

        return atualizadaRows[0];
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
