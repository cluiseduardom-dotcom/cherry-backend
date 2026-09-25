const db = require('../config/db');

async function criarCentroCusto(dados) {
    const { rows } = await db.query(
        `INSERT INTO centros_custo
            (empresa_id, filial_id, codigo, nome, centro_custo_pai_id)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [dados.empresa_id, dados.filial_id ?? null, dados.codigo,
         dados.nome, dados.centro_custo_pai_id ?? null]
    );
    return rows[0];
}

async function listarCentrosCusto({ empresa_id, ativo, limit=100, offset=0 }) {
    const filtros=['empresa_id = $1'];
    const valores=[empresa_id];
    if (ativo !== undefined) {
        valores.push(ativo);
        filtros.push(`ativo = $${valores.length}`);
    }
    valores.push(limit,offset);
    const { rows }=await db.query(
        `SELECT * FROM centros_custo
         WHERE ${filtros.join(' AND ')}
         ORDER BY codigo
         LIMIT $${valores.length-1} OFFSET $${valores.length}`,
        valores
    );
    return rows;
}

async function criarProjeto(dados) {
    const { rows } = await db.query(
        `INSERT INTO projetos
            (empresa_id, filial_id, codigo, nome, status, data_inicio, data_fim)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [dados.empresa_id, dados.filial_id ?? null, dados.codigo,
         dados.nome, dados.status ?? 'ATIVO',
         dados.data_inicio ?? null, dados.data_fim ?? null]
    );
    return rows[0];
}

async function listarProjetos({ empresa_id, status, limit=100, offset=0 }) {
    const filtros=['empresa_id = $1'];
    const valores=[empresa_id];
    if (status) {
        valores.push(status);
        filtros.push(`status = $${valores.length}`);
    }
    valores.push(limit,offset);
    const { rows }=await db.query(
        `SELECT * FROM projetos
         WHERE ${filtros.join(' AND ')}
         ORDER BY codigo
         LIMIT $${valores.length-1} OFFSET $${valores.length}`,
        valores
    );
    return rows;
}

module.exports={criarCentroCusto,listarCentrosCusto,criarProjeto,listarProjetos};
