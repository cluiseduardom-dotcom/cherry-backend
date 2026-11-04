const AppError = require('../errors/AppError');
const db = require('../config/db');
const contasRepo = require('../repositories/contasBancariasRepository');
const movimentosRepo = require('../repositories/movimentosBancariosRepository');
const extratoRepo = require('../repositories/extratoRepository');
const { lerExtrato } = require('../utils/extratoParser');

// Importação de extrato (OFX/CSV) para uma conta bancária. Dois passos: PRÉVIA (não grava nada, mostra o que
// aconteceria) e IMPORTAR (grava tudo numa transação ou nada). Lançamentos entram com origem EXTRATO e
// referência estável: reimportar o mesmo arquivo não duplica.
//
// Risco de contagem em dobro: se a conta já tem lançamento manual/Mercado Pago do mesmo valor no mesmo dia (±1),
// a linha vem como "possível duplicado" e NÃO é importada, a menos que a pessoa a inclua explicitamente.

const hojeBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const diasEntre = (a, b) => Math.round((Date.UTC(...a.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) - Date.UTC(...b.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))) / 86_400_000);

async function carregarConta(contaId, usuario) {
    const conta = await contasRepo.buscarPorId(contaId, usuario.empresa_id);
    if (!conta) throw new AppError('Conta bancária não encontrada', 404);
    if (conta.status !== 'ATIVA') throw new AppError('A conta está inativa.', 409);
    return conta;
}

async function classificar(dados, usuario) {
    const conta = await carregarConta(dados.conta_bancaria_id, usuario);
    const { formato, linhas, erros } = lerExtrato(dados.conteudo, dados.formato);
    const empresaId = usuario.empresa_id;

    const hoje = hojeBrasilia();
    const desde = await extratoRepo.dataSaldoInicial(empresaId, conta.id);
    const jaImportadas = await extratoRepo.referenciasExistentes(empresaId, conta.id, linhas.map((l) => l.referencia_externa));

    let candidatos = [];
    if (linhas.length > 0) {
        const datas = linhas.map((l) => l.data).sort();
        candidatos = await extratoRepo.movimentosParaCasar(empresaId, conta.id, datas[0], datas[datas.length - 1]);
    }
    const usados = new Set();

    const resultado = linhas.map((l) => {
        if (l.data > hoje) return { ...l, situacao: 'futura' };
        if (desde && l.data < desde) return { ...l, situacao: 'fora_do_saldo' };
        if (jaImportadas.has(l.referencia_externa)) return { ...l, situacao: 'ja_importada' };
        const centavos = Math.round(l.valor * 100);
        const par = candidatos.find((c) => !usados.has(c.id) && c.tipo === l.tipo && c.centavos === centavos && Math.abs(diasEntre(c.dia, l.data)) <= 1);
        if (par) { usados.add(par.id); return { ...l, situacao: 'possivel_duplicado', duplicado_de: par.id }; }
        return { ...l, situacao: 'nova' };
    });

    return { conta, formato, linhas: resultado, erros };
}

const contar = (linhas, situacao) => linhas.filter((l) => l.situacao === situacao).length;

function resumir(linhas, erros) {
    return {
        novas: contar(linhas, 'nova'),
        ja_importadas: contar(linhas, 'ja_importada'),
        possiveis_duplicadas: contar(linhas, 'possivel_duplicado'),
        fora_do_saldo: contar(linhas, 'fora_do_saldo'),
        futuras: contar(linhas, 'futura'),
        erros: erros.length
    };
}

async function previa(dados, usuario) {
    const { formato, linhas, erros } = await classificar(dados, usuario);
    return { formato, resumo: resumir(linhas, erros), linhas, erros };
}

async function importar(dados, usuario) {
    const { conta, linhas, erros } = await classificar(dados, usuario);
    if (linhas.length === 0) throw new AppError(erros[0]?.erro ?? 'O arquivo não tem lançamentos.', 400);

    const incluir = new Set(dados.incluir_possiveis_duplicados ?? []);
    const aImportar = linhas.filter((l) => l.situacao === 'nova' || (l.situacao === 'possivel_duplicado' && incluir.has(l.referencia_externa)));

    let gravadas = 0;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        for (const l of aImportar) {
            const { criado } = await movimentosRepo.criarSeNovo({
                empresa_id: usuario.empresa_id,
                conta_bancaria_id: conta.id,
                tipo: l.tipo,
                origem: 'EXTRATO',
                valor: l.valor,
                data_movimento: `${l.data}T12:00:00-03:00`,
                descricao: l.descricao,
                referencia_externa: l.referencia_externa,
                usuario_id: usuario.id
            }, client);
            if (criado) gravadas += 1;
        }
        await client.query('COMMIT');
    } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        throw erro;
    } finally {
        client.release();
    }

    return { importadas: gravadas, resumo: { ...resumir(linhas, erros), importadas: gravadas } };
}

async function sugestoes(movimentoId, usuario) {
    const r = await extratoRepo.sugestoesParaMovimento(usuario.empresa_id, movimentoId);
    if (!r) throw new AppError('Movimento não encontrado', 404);
    return r.titulos;
}

module.exports = { previa, importar, sugestoes };
