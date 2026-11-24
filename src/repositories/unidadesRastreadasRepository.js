'use strict';

const db = require('../config/db');
const AppError = require('../errors/AppError');
const { classificarIdentificador } = require('../utils/identificadorUnidade');

// Unidades rastreadas por IMEI / número de série (ADR-008). Todas as escritas recebem o `client` da transação de quem
// chama (entrada, venda, cancelamento): a unidade e o saldo do produto mudam juntos ou não mudam. Toda query filtra por
// empresa_id. O produto já vem travado (FOR UPDATE) por estoqueRepository.criarMovimentacao, o que serializa as unidades
// do mesmo produto; a UNIQUE (empresa_id, identificador) cobre a corrida entre produtos diferentes.

const STATUS = Object.freeze({ EM_ESTOQUE: 'em_estoque', VENDIDA: 'vendida', BAIXADA: 'baixada' });
const MAX_IDENTIFICADORES = 500;

// Valida e normaliza a lista digitada: quantidade igual ao número de identificadores, sem repetido, cada um válido.
function prepararIdentificadores(brutos, quantidade) {
    if (!Array.isArray(brutos) || brutos.length === 0) {
        throw new AppError('Este produto é rastreado por IMEI/série: informe um identificador por unidade', 400);
    }

    if (brutos.length > MAX_IDENTIFICADORES) {
        throw new AppError(`No máximo ${MAX_IDENTIFICADORES} identificadores por lançamento`, 400);
    }

    if (brutos.length !== quantidade) {
        throw new AppError(`Quantidade (${quantidade}) diferente do número de IMEI/séries informados (${brutos.length})`, 400);
    }

    const vistos = new Set();
    const lista = [];

    for (const bruto of brutos) {
        let classificado;

        try {
            classificado = classificarIdentificador(bruto);
        } catch (erro) {
            throw new AppError(erro.message, 400);
        }

        if (vistos.has(classificado.identificador)) {
            throw new AppError(`IMEI/série repetido na lista: ${classificado.identificador}`, 400);
        }

        vistos.add(classificado.identificador);
        lista.push(classificado);
    }

    return lista;
}

async function registrarEventos(client, { empresa_id, unidades, evento, referencia, motivo, usuario_id }) {
    if (!unidades.length) return;

    await client.query(
        `INSERT INTO unidades_rastreadas_eventos (empresa_id, unidade_id, evento, referencia, motivo, usuario_id)
         SELECT $1, u, $2, $3, $4, $5 FROM unnest($6::int[]) AS u`,
        [empresa_id, evento, referencia ?? null, motivo ?? null, usuario_id ?? null, unidades.map((u) => u.id)]
    );
}

// Entrada: cria uma unidade `em_estoque` por identificador. Identificador já cadastrado na empresa = 409.
async function registrarEntrada(client, { empresa_id, produto_id, identificadores, compra_id, usuario_id, referencia }) {
    const codigos = identificadores.map((i) => i.identificador);

    const { rows: existentes } = await client.query(
        'SELECT identificador FROM unidades_rastreadas WHERE empresa_id = $1 AND identificador = ANY($2::text[])',
        [empresa_id, codigos]
    );

    if (existentes.length) {
        throw new AppError(`IMEI/série já cadastrado: ${existentes.map((e) => e.identificador).join(', ')}`, 409);
    }

    let inseridas;

    try {
        ({ rows: inseridas } = await client.query(
            `INSERT INTO unidades_rastreadas (empresa_id, produto_id, identificador, tipo_identificador, status, compra_id)
             SELECT $1, $2, i, t, 'em_estoque', $5
             FROM unnest($3::text[], $4::text[]) AS x(i, t)
             RETURNING id, identificador`,
            [empresa_id, produto_id, codigos, identificadores.map((i) => i.tipo), compra_id ?? null]
        ));
    } catch (erro) {
        if (erro.code === '23505') {
            throw new AppError('IMEI/série já cadastrado', 409);
        }
        throw erro;
    }

    await registrarEventos(client, { empresa_id, unidades: inseridas, evento: 'entrada', referencia, usuario_id });

    return inseridas;
}

// Saída de unidades específicas (venda ou baixa): cada identificador precisa estar `em_estoque` NESTE produto.
async function baixarPorIdentificadores(client, { empresa_id, produto_id, identificadores, statusNovo, evento, referencia, motivo, usuario_id }) {
    const codigos = identificadores.map((i) => i.identificador);

    const { rows } = await client.query(
        `SELECT id, identificador FROM unidades_rastreadas
         WHERE empresa_id = $1 AND produto_id = $2 AND status = 'em_estoque' AND identificador = ANY($3::text[])
         ORDER BY id FOR UPDATE`,
        [empresa_id, produto_id, codigos]
    );

    if (rows.length !== codigos.length) {
        const achados = new Set(rows.map((r) => r.identificador));
        const faltando = codigos.filter((c) => !achados.has(c));
        throw new AppError(`IMEI/série não está em estoque para este produto: ${faltando.join(', ')}`, 409);
    }

    await client.query(
        'UPDATE unidades_rastreadas SET status = $1, atualizado_em = NOW() WHERE empresa_id = $2 AND id = ANY($3::int[])',
        [statusNovo, empresa_id, rows.map((r) => r.id)]
    );

    await registrarEventos(client, { empresa_id, unidades: rows, evento, referencia, motivo, usuario_id });

    return rows;
}

// Liga as unidades vendidas ao item da venda (para o cancelamento saber quais voltam).
async function vincularItemVenda(client, { empresa_id, produto_id, identificadores, item_venda_id }) {
    await client.query(
        `UPDATE unidades_rastreadas SET item_venda_id = $1
         WHERE empresa_id = $2 AND produto_id = $3 AND identificador = ANY($4::text[]) AND status = 'vendida'`,
        [item_venda_id, empresa_id, produto_id, identificadores]
    );
}

// Cancelamento de venda (R4): as unidades do item voltam a `em_estoque`; o histórico fica nos eventos.
async function identificadoresDoItemVenda(client, { empresa_id, item_venda_id }) {
    const { rows } = await client.query(
        `SELECT identificador FROM unidades_rastreadas
         WHERE empresa_id = $1 AND item_venda_id = $2 AND status = 'vendida' ORDER BY id`,
        [empresa_id, item_venda_id]
    );

    return rows.map((r) => r.identificador);
}

async function reativarDaVenda(client, { empresa_id, produto_id, identificadores, referencia, usuario_id }) {
    const { rows } = await client.query(
        `SELECT id, identificador FROM unidades_rastreadas
         WHERE empresa_id = $1 AND produto_id = $2 AND status = 'vendida' AND identificador = ANY($3::text[])
         ORDER BY id FOR UPDATE`,
        [empresa_id, produto_id, identificadores]
    );

    if (rows.length !== identificadores.length) {
        throw new AppError('Unidades desta venda não estão mais como vendidas; não é possível devolver ao estoque', 409);
    }

    await client.query(
        `UPDATE unidades_rastreadas SET status = 'em_estoque', item_venda_id = NULL, atualizado_em = NOW()
         WHERE empresa_id = $1 AND id = ANY($2::int[])`,
        [empresa_id, rows.map((r) => r.id)]
    );

    await registrarEventos(client, { empresa_id, unidades: rows, evento: 'cancelamento_venda', referencia, usuario_id });

    return rows;
}

// Cancelamento de compra: todas as unidades dela precisam ainda estar em estoque; saem como `baixada`.
async function baixarDaCompra(client, { empresa_id, produto_id, compra_id, usuario_id }) {
    const { rows } = await client.query(
        `SELECT id, identificador, status FROM unidades_rastreadas
         WHERE empresa_id = $1 AND produto_id = $2 AND compra_id = $3 ORDER BY id FOR UPDATE`,
        [empresa_id, produto_id, compra_id]
    );

    const fora = rows.filter((r) => r.status !== STATUS.EM_ESTOQUE);

    if (fora.length) {
        throw new AppError(
            `Não é possível cancelar a compra: IMEI/série já saiu do estoque (${fora.map((r) => r.identificador).join(', ')})`,
            409
        );
    }

    if (rows.length) {
        await client.query(
            `UPDATE unidades_rastreadas SET status = 'baixada', atualizado_em = NOW() WHERE empresa_id = $1 AND id = ANY($2::int[])`,
            [empresa_id, rows.map((r) => r.id)]
        );
    }

    await registrarEventos(client, {
        empresa_id, unidades: rows, evento: 'cancelamento_compra', referencia: `compra:${compra_id}`, usuario_id
    });

    return rows;
}

// Leitura (consulta e escolha do IMEI na venda). Nunca devolve custo.
async function listar({ empresa_id, produto_id, status, busca, limit, offset }) {
    const condicoes = ['u.empresa_id = $1'];
    const valores = [empresa_id];

    if (produto_id !== undefined) {
        valores.push(produto_id);
        condicoes.push(`u.produto_id = $${valores.length}`);
    }

    if (status !== undefined) {
        valores.push(status);
        condicoes.push(`u.status = $${valores.length}`);
    }

    if (busca) {
        valores.push(`%${String(busca).toUpperCase().replace(/[\s\-/.]/g, '').replace(/[%_\\]/g, '\\$&')}%`);
        condicoes.push(`u.identificador LIKE $${valores.length}`);
    }

    const where = condicoes.join(' AND ');
    const { rows } = await db.query(
        `SELECT u.id, u.produto_id, p.nome AS produto_nome, p.sku AS produto_sku, u.identificador, u.tipo_identificador,
                u.status, u.compra_id, u.criado_em
         FROM unidades_rastreadas u
         JOIN produtos p ON p.id = u.produto_id AND p.empresa_id = u.empresa_id
         WHERE ${where}
         ORDER BY u.id DESC
         LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limit, offset]
    );
    const { rows: [{ total }] } = await db.query(`SELECT COUNT(*)::int AS total FROM unidades_rastreadas u WHERE ${where}`, valores);

    return { items: rows, total };
}

async function buscarComHistorico({ empresa_id, identificador }) {
    const { rows } = await db.query(
        `SELECT u.id, u.produto_id, p.nome AS produto_nome, p.sku AS produto_sku, u.identificador, u.tipo_identificador,
                u.status, u.compra_id, u.item_venda_id, u.criado_em
         FROM unidades_rastreadas u
         JOIN produtos p ON p.id = u.produto_id AND p.empresa_id = u.empresa_id
         WHERE u.empresa_id = $1 AND u.identificador = $2`,
        [empresa_id, identificador]
    );

    if (!rows.length) return null;

    const { rows: eventos } = await db.query(
        `SELECT e.evento, e.referencia, e.motivo, e.usuario_id, e.criado_em
         FROM unidades_rastreadas_eventos e
         WHERE e.empresa_id = $1 AND e.unidade_id = $2 ORDER BY e.id`,
        [empresa_id, rows[0].id]
    );

    return { ...rows[0], eventos };
}

module.exports = {
    STATUS,
    MAX_IDENTIFICADORES,
    prepararIdentificadores,
    registrarEntrada,
    baixarPorIdentificadores,
    vincularItemVenda,
    identificadoresDoItemVenda,
    reativarDaVenda,
    baixarDaCompra,
    listar,
    buscarComHistorico
};
