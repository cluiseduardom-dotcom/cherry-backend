const db = require('../config/db');
const AppError = require('../errors/AppError');
const estoqueRepository = require('./estoqueRepository');
const { executarComLock } = require('./shared/transacoes');

const COLUNAS = `t.id, t.status, t.observacao, t.criado_em, t.resolvido_em, t.motivo_resolucao,
        t.origem_local_id, lo.nome AS origem_nome, lo.tipo AS origem_tipo, lo.usuario_id AS origem_usuario_id,
        t.destino_local_id, ld.nome AS destino_nome, ld.tipo AS destino_tipo, ld.usuario_id AS destino_usuario_id,
        t.criado_por, uc.nome AS criado_por_nome, t.resolvido_por, ur.nome AS resolvido_por_nome`;

const JUNCOES = `FROM transferencias_estoque t
        JOIN locais_estoque lo ON lo.id = t.origem_local_id AND lo.empresa_id = t.empresa_id
        JOIN locais_estoque ld ON ld.id = t.destino_local_id AND ld.empresa_id = t.empresa_id
        JOIN usuarios uc ON uc.id = t.criado_por AND uc.empresa_id = t.empresa_id
        LEFT JOIN usuarios ur ON ur.id = t.resolvido_por AND ur.empresa_id = t.empresa_id`;

async function buscarLocais(client, empresa_id, ids) {
    const { rows } = await client.query(
        'SELECT id, tipo, nome, usuario_id, ativo FROM locais_estoque WHERE empresa_id = $1 AND id = ANY($2::int[])',
        [empresa_id, ids]
    );
    return new Map(rows.map((l) => [l.id, l]));
}

// Uma perna = uma movimentação de estoque comum (trava produto e saldo do local, recusa saldo negativo).
async function perna(client, { produto_id, tipo, quantidade, local_id, motivo, usuario_id, empresa_id, transferencia_id }) {
    const r = await estoqueRepository.criarMovimentacao(
        { produto_id, tipo, quantidade, local_id, motivo, usuario_id, empresa_id, transferencia_id },
        client
    );

    if (r.erro === 'ESTOQUE_INSUFICIENTE') {
        throw new AppError(`Estoque insuficiente no local para o produto #${produto_id}`, 409);
    }
    if (r.erro) {
        throw new AppError('Produto ou local não encontrado', 404);
    }
}

async function itensDe(client, empresa_id, transferencia_id) {
    const { rows } = await client.query(
        `SELECT i.produto_id, i.quantidade, p.nome AS produto_nome, p.sku AS produto_sku
         FROM transferencia_itens i
         JOIN produtos p ON p.id = i.produto_id AND p.empresa_id = i.empresa_id
         WHERE i.empresa_id = $1 AND i.transferencia_id = $2
         ORDER BY i.produto_id`,
        [empresa_id, transferencia_id]
    );
    return rows;
}

async function evento(client, { empresa_id, transferencia_id, acao, executado_por, motivo }) {
    await client.query(
        `INSERT INTO transferencias_eventos (empresa_id, transferencia_id, acao, executado_por, motivo)
         VALUES ($1, $2, $3, $4, $5)`,
        [empresa_id, transferencia_id, acao, executado_por, motivo ?? null]
    );
}

// Cria a transferência pendente e já tira a mercadoria da origem para o "Em trânsito", tudo numa
// transação. `autorizar(origem, destino)` é a regra de quem pode criar (decidida no service).
async function criar({ empresa_id, usuario_id, origem_local_id, destino_local_id, itens, observacao, autorizar }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const locais = await buscarLocais(client, empresa_id, [origem_local_id, destino_local_id]);
        const origem = locais.get(origem_local_id);
        const destino = locais.get(destino_local_id);

        if (!origem || !destino) throw new AppError('Local de estoque não encontrado', 404);
        if (!origem.ativo || !destino.ativo) throw new AppError('Local de estoque inativo', 400);
        if (origem.tipo === 'transito' || destino.tipo === 'transito') {
            throw new AppError('Em trânsito não pode ser origem nem destino de uma transferência', 400);
        }
        autorizar(origem, destino);

        const ordenados = [...itens].sort((a, b) => a.produto_id - b.produto_id);
        // Trava os produtos já aqui, em ordem crescente de id, ANTES de inserir qualquer linha que os
        // referencie por FK. Sem isso, duas transferências do mesmo produto seguram o lock compartilhado
        // da FK e ambas tentam o FOR UPDATE de criarMovimentacao: deadlock.
        const { rows: produtos } = await client.query(
            'SELECT id, ativo FROM produtos WHERE empresa_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE',
            [empresa_id, ordenados.map((i) => i.produto_id)]
        );
        if (produtos.length !== ordenados.length) throw new AppError('Produto não encontrado', 404);
        if (produtos.some((p) => !p.ativo)) throw new AppError('Produto inativo não pode ser transferido', 400);

        const { rows } = await client.query(
            `INSERT INTO transferencias_estoque (empresa_id, origem_local_id, destino_local_id, observacao, criado_por)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [empresa_id, origem_local_id, destino_local_id, observacao ?? null, usuario_id]
        );
        const transferencia_id = rows[0].id;
        const transitoId = await estoqueRepository.garantirLocalTransito(client, empresa_id);

        // Ordem fixa por produto: duas transferências concorrentes nunca travam em ordens opostas.
        for (const item of ordenados) {
            await client.query(
                'INSERT INTO transferencia_itens (transferencia_id, produto_id, empresa_id, quantidade) VALUES ($1, $2, $3, $4)',
                [transferencia_id, item.produto_id, empresa_id, item.quantidade]
            );
            const base = { produto_id: item.produto_id, quantidade: item.quantidade, usuario_id, empresa_id, transferencia_id };
            await perna(client, { ...base, tipo: 'saida', local_id: origem_local_id, motivo: `Transferência #${transferencia_id} (envio)` });
            await perna(client, { ...base, tipo: 'entrada', local_id: transitoId, motivo: `Transferência #${transferencia_id} (em trânsito)` });
        }

        await evento(client, { empresa_id, transferencia_id, acao: 'criar', executado_por: usuario_id, motivo: observacao });
        await client.query('COMMIT');

        return transferencia_id;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

const DESFECHOS = {
    aceitar: { status: 'concluida', destinoDaMercadoria: 'destino' },
    recusar: { status: 'recusada', destinoDaMercadoria: 'origem' },
    cancelar: { status: 'cancelada', destinoDaMercadoria: 'origem' }
};

// Aceitar, recusar ou cancelar uma transferência PENDENTE. A linha é travada (FOR UPDATE): dois
// cliques/requisições simultâneos nunca movem o estoque duas vezes (o 2º vê o status já resolvido).
// `autorizar(transferenciaComLocais)` é a regra de quem pode (decidida no service).
async function resolver({ empresa_id, id, acao, usuario_id, motivo, autorizar }) {
    const desfecho = DESFECHOS[acao];

    return executarComLock('transferencias_estoque', { coluna: 'id', valor: id }, empresa_id, null, async (t, client) => {
        if (!t) throw new AppError('Transferência não encontrada', 404);

        const locais = await buscarLocais(client, empresa_id, [t.origem_local_id, t.destino_local_id]);
        autorizar({ ...t, origem: locais.get(t.origem_local_id), destino: locais.get(t.destino_local_id) });

        if (t.status !== 'pendente') {
            throw new AppError(`Transferência já está ${t.status}`, 409);
        }

        const transitoId = await estoqueRepository.garantirLocalTransito(client, empresa_id);
        const paraLocal = desfecho.destinoDaMercadoria === 'destino' ? t.destino_local_id : t.origem_local_id;
        const rotulo = { aceitar: 'aceite', recusar: 'recusa', cancelar: 'cancelamento' }[acao];

        for (const item of await itensDe(client, empresa_id, id)) {
            const base = { produto_id: item.produto_id, quantidade: item.quantidade, usuario_id, empresa_id, transferencia_id: id };
            await perna(client, { ...base, tipo: 'saida', local_id: transitoId, motivo: `Transferência #${id} (${rotulo})` });
            await perna(client, { ...base, tipo: 'entrada', local_id: paraLocal, motivo: `Transferência #${id} (${rotulo})` });
        }

        await client.query(
            `UPDATE transferencias_estoque
             SET status = $1, resolvido_por = $2, resolvido_em = NOW(), motivo_resolucao = $3
             WHERE id = $4 AND empresa_id = $5`,
            [desfecho.status, usuario_id, motivo ?? null, id, empresa_id]
        );
        await evento(client, { empresa_id, transferencia_id: id, acao, executado_por: usuario_id, motivo });

        return id;
    });
}

async function obter(empresa_id, id, client = db) {
    const { rows } = await client.query(`SELECT ${COLUNAS} ${JUNCOES} WHERE t.empresa_id = $1 AND t.id = $2`, [empresa_id, id]);
    if (!rows.length) return null;

    const { rows: eventos } = await client.query(
        `SELECT e.id, e.acao, e.executado_por, u.nome AS executado_por_nome, e.motivo, e.criado_em
         FROM transferencias_eventos e
         JOIN usuarios u ON u.id = e.executado_por AND u.empresa_id = e.empresa_id
         WHERE e.empresa_id = $1 AND e.transferencia_id = $2
         ORDER BY e.id`,
        [empresa_id, id]
    );

    return { ...rows[0], itens: await itensDe(client, empresa_id, id), eventos };
}

// `usuario_id` restringe a transferências que o usuário criou ou em que ele é dono de uma das
// pontas (maleta). Omitido = equipe de estoque/admin, vê todas da empresa.
async function listar({ empresa_id, status, usuario_id, limit, offset }) {
    const condicoes = ['t.empresa_id = $1'];
    const valores = [empresa_id];

    if (status) {
        valores.push(status);
        condicoes.push(`t.status = $${valores.length}`);
    }
    if (usuario_id !== undefined) {
        valores.push(usuario_id);
        condicoes.push(`(t.criado_por = $${valores.length} OR lo.usuario_id = $${valores.length} OR ld.usuario_id = $${valores.length})`);
    }

    const where = condicoes.join(' AND ');
    const { rows } = await db.query(
        `SELECT ${COLUNAS} ${JUNCOES} WHERE ${where}
         ORDER BY t.criado_em DESC, t.id DESC LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
        [...valores, limit, offset]
    );
    const { rows: contagem } = await db.query(`SELECT COUNT(*) ${JUNCOES} WHERE ${where}`, valores);

    return { items: rows, total: Number(contagem[0].count) };
}

// Cria um local de estoque (maleta de um usuário ou consignado). Central e Em trânsito são automáticos.
async function criarLocal({ empresa_id, tipo, nome, usuario_id, cliente_id }) {
    try {
        if (tipo === 'maleta') {
            const { rows: u } = await db.query('SELECT id, nome, ativo FROM usuarios WHERE id = $1 AND empresa_id = $2', [usuario_id, empresa_id]);
            if (!u.length) throw new AppError('Usuário não encontrado', 404);
            if (!u[0].ativo) throw new AppError('Usuário bloqueado não pode ter maleta', 400);
            nome = nome || `Maleta de ${u[0].nome}`;
        }
        if (tipo === 'consignado' && cliente_id) {
            const { rows: c } = await db.query('SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2', [cliente_id, empresa_id]);
            if (!c.length) throw new AppError('Cliente não encontrado', 404);
        }

        const { rows } = await db.query(
            `INSERT INTO locais_estoque (empresa_id, tipo, nome, usuario_id, cliente_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, tipo, nome, usuario_id, cliente_id, ativo`,
            [empresa_id, tipo, nome, tipo === 'maleta' ? usuario_id : null, tipo === 'consignado' ? (cliente_id ?? null) : null]
        );
        return rows[0];
    } catch (error) {
        if (error.code === '23505') {
            throw new AppError(tipo === 'maleta' ? 'Este usuário já tem maleta' : 'Este cliente já tem local consignado', 409);
        }
        throw error;
    }
}

module.exports = { criar, resolver, obter, listar, criarLocal };
