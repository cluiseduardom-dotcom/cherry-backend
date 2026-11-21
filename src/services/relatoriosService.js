const AppError = require('../errors/AppError');
const repo = require('../repositories/relatoriosRepository');
const { arredondar, percentual } = require('../utils/resultadoVenda');
const { hojeSP } = require('../utils/dataSaoPaulo');
const {
    diasEntre,
    periodoAnterior,
    variacaoPct,
    classificarCurvaAbc,
    coberturaDias,
    FAIXAS_ATRASO,
    diasDeAtraso,
    faixaDeAtraso
} = require('../utils/relatorios');
const { podeVerCustos, podeVerCustosOperacionais } = require('./permissoesService');

// Relatórios de gestão (somente leitura). Custo, lucro e margem só saem para quem pode ver custos: para os
// demais o campo é OMITIDO (nunca vem zerado, que pareceria dado real). A permissão de abrir cada relatório
// é decidida nas rotas; aqui só se decide quais campos entram.

const num = (valor) => {
    const n = Number(valor);

    return Number.isFinite(n) ? n : 0;
};
const dinheiro = (valor) => arredondar(num(valor), 2);
const ticket = (receita, vendas) => (vendas > 0 ? arredondar(receita / vendas, 2) : null);

function resumoDoPeriodo(linha) {
    const vendas = num(linha.vendas);
    const receita = num(linha.receita);

    return {
        vendas,
        receita: dinheiro(receita),
        ticket_medio: ticket(receita, vendas),
        itens: num(linha.itens),
        desconto: dinheiro(linha.desconto),
        juros: dinheiro(linha.juros)
    };
}

function comMargem(objeto, receita, custo) {
    const lucro = arredondar(receita - custo, 2);

    return { ...objeto, custo: dinheiro(custo), lucro_bruto: lucro, margem_bruta_pct: percentual(lucro, receita) };
}

async function vendas({ data_de: dataDe, data_ate: dataAte }, usuario) {
    const empresaId = usuario.empresa_id;
    const verCustos = podeVerCustos(usuario);
    const anterior = periodoAnterior(dataDe, dataAte);

    const [atual, ant, canceladas, porCanal, porForma, porDiaSemana, clientes] = await Promise.all([
        repo.totaisVendas(empresaId, dataDe, dataAte),
        repo.totaisVendas(empresaId, anterior.data_de, anterior.data_ate),
        repo.canceladasDoPeriodo(empresaId, dataDe, dataAte),
        repo.vendasPorCanal(empresaId, dataDe, dataAte),
        repo.vendasPorFormaPagamento(empresaId, dataDe, dataAte),
        repo.vendasPorDiaSemana(empresaId, dataDe, dataAte),
        repo.topClientes(empresaId, dataDe, dataAte, 10)
    ]);

    const totais = resumoDoPeriodo(atual);
    const totaisAnt = resumoDoPeriodo(ant);
    const receitaTotal = num(atual.receita);
    const vendasPorDia = new Map(porDiaSemana.map((l) => [l.dia_semana, l]));

    return {
        periodo: { data_de: dataDe, data_ate: dataAte, dias: diasEntre(dataDe, dataAte) },
        totais: verCustos ? comMargem(totais, receitaTotal, num(atual.custo)) : totais,
        comparativo: {
            periodo_anterior: { data_de: anterior.data_de, data_ate: anterior.data_ate },
            vendas: { atual: totais.vendas, anterior: totaisAnt.vendas, variacao_pct: variacaoPct(totais.vendas, totaisAnt.vendas) },
            receita: { atual: totais.receita, anterior: totaisAnt.receita, variacao_pct: variacaoPct(totais.receita, totaisAnt.receita) },
            ticket_medio: {
                atual: totais.ticket_medio,
                anterior: totaisAnt.ticket_medio,
                variacao_pct: variacaoPct(totais.ticket_medio, totaisAnt.ticket_medio)
            }
        },
        canceladas: { vendas: num(canceladas.vendas), valor: dinheiro(canceladas.valor) },
        por_canal: porCanal.map((l) => {
            const receita = num(l.receita);
            const base = {
                canal_id: l.canal_id,
                nome: l.nome ?? 'Sem canal',
                vendas: num(l.vendas),
                receita: dinheiro(receita),
                ticket_medio: ticket(receita, num(l.vendas)),
                participacao_pct: percentual(receita, receitaTotal)
            };

            return verCustos ? comMargem(base, receita, num(l.custo)) : base;
        }),
        por_forma_pagamento: porForma.map((l) => ({
            forma_pagamento: l.forma_pagamento,
            vendas: num(l.vendas),
            valor: dinheiro(l.valor)
        })),
        // 0 = domingo ... 6 = sábado. Os 7 dias sempre aparecem, mesmo sem venda.
        por_dia_semana: Array.from({ length: 7 }, (_, dia) => {
            const l = vendasPorDia.get(dia);

            return { dia_semana: dia, vendas: num(l?.vendas), receita: dinheiro(l?.receita) };
        }),
        top_clientes: clientes.map((l) => ({
            cliente_id: l.cliente_id,
            nome: l.nome,
            vendas: num(l.vendas),
            receita: dinheiro(l.receita)
        }))
    };
}

async function desempenho({ data_de: dataDe, data_ate: dataAte }, usuario) {
    const empresaId = usuario.empresa_id;
    const verCustos = podeVerCustos(usuario);

    const [linhas, canceladas] = await Promise.all([
        repo.desempenhoPorVendedor(empresaId, dataDe, dataAte),
        repo.canceladasPorVendedor(empresaId, dataDe, dataAte)
    ]);

    const canceladasDe = new Map(canceladas.map((l) => [l.usuario_id, num(l.vendas)]));
    const receitaTotal = linhas.reduce((soma, l) => soma + num(l.receita), 0);

    const vendedores = linhas.map((l, indice) => {
        const receita = num(l.receita);
        const vendasDoVendedor = num(l.vendas);
        const base = {
            posicao: indice + 1,
            usuario_id: l.usuario_id,
            nome: l.nome ?? 'Usuário removido',
            vendas: vendasDoVendedor,
            receita: dinheiro(receita),
            participacao_pct: percentual(receita, receitaTotal),
            ticket_medio: ticket(receita, vendasDoVendedor),
            itens: num(l.itens),
            itens_por_venda: vendasDoVendedor > 0 ? arredondar(num(l.itens) / vendasDoVendedor, 2) : null,
            comissao: dinheiro(l.comissao),
            canceladas: canceladasDe.get(l.usuario_id) ?? 0
        };

        return verCustos ? comMargem(base, receita, num(l.custo)) : base;
    });

    return {
        periodo: { data_de: dataDe, data_ate: dataAte, dias: diasEntre(dataDe, dataAte) },
        totais: { vendas: vendedores.reduce((s, v) => s + v.vendas, 0), receita: dinheiro(receitaTotal) },
        vendedores
    };
}

async function produtos({ data_de: dataDe, data_ate: dataAte, ordem, limite }, usuario) {
    const empresaId = usuario.empresa_id;
    const verCustos = podeVerCustos(usuario);
    const dias = diasEntre(dataDe, dataAte);

    const [vendidos, parados] = await Promise.all([
        repo.produtosVendidos(empresaId, dataDe, dataAte),
        repo.produtosSemVenda(empresaId, dataDe, dataAte, 50)
    ]);

    const base = vendidos.map((l) => ({
        produto_id: l.produto_id,
        sku: l.sku,
        nome: l.nome,
        quantidade: num(l.quantidade),
        receita: dinheiro(l.receita),
        custo: dinheiro(l.custo),
        estoque_atual: num(l.estoque_atual),
        cobertura_dias: coberturaDias(l.estoque_atual, l.quantidade, dias),
        ultima_venda: l.ultima_venda
    }));

    // A curva usa TODOS os produtos vendidos (não só os da página): cortar antes distorceria os 80%.
    const classificados = classificarCurvaAbc(base);

    const comMargemDoItem = classificados.map((p) => {
        const lucro = arredondar(p.receita - p.custo, 2);

        return { ...p, lucro_bruto: lucro, margem_bruta_pct: percentual(lucro, p.receita) };
    });

    const ordenadores = {
        receita: (x, y) => y.receita - x.receita,
        quantidade: (x, y) => y.quantidade - x.quantidade,
        margem: (x, y) => (y.margem_bruta_pct ?? -Infinity) - (x.margem_bruta_pct ?? -Infinity)
    };
    // Ordenar por margem revela custo: sem permissão cai para receita, sem erro e sem pista do custo.
    const ordemEfetiva = ordem === 'margem' && !verCustos ? 'receita' : ordem;
    const lista = [...comMargemDoItem].sort(ordenadores[ordemEfetiva] ?? ordenadores.receita).slice(0, limite);

    const semCusto = ({ custo: _custo, lucro_bruto: _lucro, margem_bruta_pct: _margem, ...resto }) => resto;

    return {
        periodo: { data_de: dataDe, data_ate: dataAte, dias },
        ordem: ordemEfetiva,
        totais: { produtos_vendidos: base.length, quantidade: base.reduce((s, p) => s + p.quantidade, 0) },
        produtos: verCustos ? lista : lista.map(semCusto),
        sem_venda: {
            produtos: num(parados.resumo.produtos),
            unidades: num(parados.resumo.unidades),
            ...(verCustos ? { valor_custo: dinheiro(parados.resumo.valor_custo) } : {}),
            itens: parados.itens.map((p) => ({
                produto_id: p.produto_id,
                sku: p.sku,
                nome: p.nome,
                estoque_atual: num(p.estoque_atual),
                ...(verCustos ? { valor_custo: dinheiro(num(p.estoque_atual) * num(p.custo)) } : {})
            }))
        }
    };
}

async function inventario({ local_id: localId, tipo, somente_com_saldo: somenteComSaldo, page, pageSize }, usuario) {
    const empresaId = usuario.empresa_id;
    const verValores = podeVerCustosOperacionais(usuario);
    const tipoProduto = tipo === 'insumo' ? 'insumo' : 'acabado';

    let local = null;

    if (localId) {
        local = await repo.localExiste(empresaId, localId);

        // Local de outra empresa é igual a local inexistente: 404, sem revelar que existe.
        if (!local) throw new AppError('Local de estoque não encontrado', 404);
    }

    const [posicao, locais] = await Promise.all([
        repo.posicaoEstoque(empresaId, {
            localId,
            tipoProduto,
            somenteComSaldo,
            limit: pageSize,
            offset: (page - 1) * pageSize
        }),
        repo.resumoPorLocal(empresaId, tipoProduto)
    ]);

    const total = num(posicao.totais.produtos);

    return {
        tipo,
        local: local ? { id: local.id, nome: local.nome, tipo: local.tipo } : null,
        totais: {
            produtos: total,
            unidades: num(posicao.totais.unidades),
            abaixo_minimo: num(posicao.totais.abaixo_minimo),
            ...(verValores ? { valor_custo: dinheiro(posicao.totais.valor_custo) } : {})
        },
        por_local: locais.map((l) => ({
            local_id: l.local_id,
            nome: l.nome,
            tipo: l.tipo,
            produtos: num(l.produtos),
            unidades: num(l.unidades),
            ...(verValores ? { valor_custo: dinheiro(l.valor_custo) } : {})
        })),
        items: posicao.itens.map((l) => {
            const saldo = num(l.saldo);

            return {
                produto_id: l.produto_id,
                sku: l.sku,
                nome: l.nome,
                unidade: l.unidade,
                ativo: l.ativo,
                saldo,
                estoque_minimo: num(l.estoque_minimo),
                abaixo_minimo: num(l.estoque_minimo) > 0 && saldo <= num(l.estoque_minimo),
                ...(verValores ? { custo_unitario: dinheiro(l.custo), valor_custo: dinheiro(saldo * num(l.custo)) } : {})
            };
        }),
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
}

async function credito({ data_ref: dataRef }, usuario) {
    const empresaId = usuario.empresa_id;
    const referencia = dataRef ?? hojeSP();
    const comFiado = Array.isArray(usuario.funcionalidades) && usuario.funcionalidades.includes('fiado');

    const [contas, fiado] = await Promise.all([
        repo.contasEmAberto(empresaId),
        comFiado ? repo.saldosFiado(empresaId) : Promise.resolve([])
    ]);

    const faixas = new Map(FAIXAS_ATRASO.map((f) => [f.codigo, { faixa: f.codigo, rotulo: f.rotulo, titulos: 0, valor: 0 }]));
    const porCliente = new Map();
    let total = 0;
    let vencido = 0;

    const clienteDe = (id) => {
        const chave = id ?? 0;

        if (!porCliente.has(chave)) {
            porCliente.set(chave, { cliente_id: id ?? null, em_aberto: 0, vencido: 0, maior_atraso_dias: 0, fiado: 0 });
        }

        return porCliente.get(chave);
    };

    for (const conta of contas) {
        const restante = num(conta.restante);

        if (restante <= 0) continue;

        const dias = diasDeAtraso(conta.vencimento, referencia);
        const faixa = faixas.get(faixaDeAtraso(dias).codigo);
        const cliente = clienteDe(conta.cliente_id);

        faixa.titulos += 1;
        faixa.valor += restante;
        total += restante;
        cliente.em_aberto += restante;

        if (dias > 0) {
            vencido += restante;
            cliente.vencido += restante;
            cliente.maior_atraso_dias = Math.max(cliente.maior_atraso_dias, dias);
        }
    }

    let fiadoTotal = 0;

    for (const saldo of fiado) {
        fiadoTotal += num(saldo.saldo);
        clienteDe(saldo.cliente_id).fiado += num(saldo.saldo);
    }

    const ranking = [...porCliente.values()]
        .sort((x, y) => (y.em_aberto + y.fiado) - (x.em_aberto + x.fiado))
        .slice(0, 20);
    const nomes = await repo.nomesDeClientes(empresaId, ranking.map((c) => c.cliente_id).filter(Boolean));

    return {
        data_ref: referencia,
        totais: {
            contas_a_receber: dinheiro(total),
            vencido: dinheiro(vencido),
            a_vencer: dinheiro(total - vencido),
            inadimplencia_pct: percentual(vencido, total),
            ...(comFiado ? { fiado: dinheiro(fiadoTotal) } : {})
        },
        aging: [...faixas.values()].map((f) => ({ ...f, valor: dinheiro(f.valor) })),
        clientes: ranking.map((c) => ({
            cliente_id: c.cliente_id,
            nome: c.cliente_id ? nomes.get(c.cliente_id) ?? 'Cliente' : 'Sem cliente identificado',
            em_aberto: dinheiro(c.em_aberto),
            vencido: dinheiro(c.vencido),
            maior_atraso_dias: c.maior_atraso_dias,
            ...(comFiado ? { fiado: dinheiro(c.fiado) } : {})
        }))
    };
}

module.exports = { vendas, desempenho, produtos, inventario, credito };
