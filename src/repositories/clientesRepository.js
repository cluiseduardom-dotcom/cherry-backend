const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');

// `somente_do_usuario` (id do usuário do JWT) restringe aos clientes que ele cadastrou; undefined = todos
// da empresa (quem tem `ver_todos_clientes`). O filtro de empresa vale SEMPRE.
async function listar(empresa_id, somente_do_usuario) {
    if (somente_do_usuario === undefined) {
        const { rows } = await db.query('SELECT * FROM clientes WHERE empresa_id = $1', [empresa_id]);
        return rows;
    }

    const { rows } = await db.query(
        'SELECT * FROM clientes WHERE empresa_id = $1 AND criado_por = $2',
        [empresa_id, somente_do_usuario]
    );
    return rows;
}

async function criar({
    nome, telefone, email, cpf_cnpj, cep, endereco, numero, complemento, bairro, cidade, uf,
    data_nascimento, observacoes, empresa_id, criado_por
}) {
    const { rows } = await db.query(
        `INSERT INTO clientes (
            nome, telefone, email, cpf_cnpj, cep, endereco, numero, complemento, bairro, cidade, uf,
            data_nascimento, observacoes, empresa_id, criado_por
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
            nome, telefone, email,
            cpf_cnpj ?? null, cep ?? null, endereco ?? null, numero ?? null, complemento ?? null,
            bairro ?? null, cidade ?? null, uf ?? null, data_nascimento ?? null, observacoes ?? null,
            empresa_id, criado_por ?? null
        ]
    );

    return rows[0];
}

async function buscarPorId(id, empresa_id, somente_do_usuario) {
    const valores = [id, empresa_id];
    let filtro = '';

    if (somente_do_usuario !== undefined) {
        valores.push(somente_do_usuario);
        filtro = 'AND criado_por = $3';
    }

    const { rows } = await db.query(
        `SELECT * FROM clientes WHERE id = $1 AND empresa_id = $2 ${filtro}`,
        valores
    );
    return rows.length ? rows[0] : null;
}

// Sem `atualizado_em = NOW()` (diferente do padrão de fornecedoresRepository.
// atualizar): a coluna não existe em `clientes` — decisão já tomada de não
// adicionar criado_em/atualizado_em nesta tabela.
async function atualizar(id, dados, empresa_id, somente_do_usuario) {
    const campos = [
        'nome', 'telefone', 'email', 'cpf_cnpj', 'cep', 'endereco', 'numero', 'complemento',
        'bairro', 'cidade', 'uf', 'data_nascimento', 'observacoes', 'ativo'
    ];

    const sets = [];
    const valores = [];
    let i = 1;

    for (const campo of campos) {
        if (dados[campo] !== undefined) {
            sets.push(`${campo} = $${i}`);
            valores.push(dados[campo]);
            i++;
        }
    }

    valores.push(id, empresa_id);
    let filtro = '';

    if (somente_do_usuario !== undefined) {
        valores.push(somente_do_usuario);
        filtro = `AND criado_por = $${i + 2}`;
    }

    const { rows } = await db.query(
        `UPDATE clientes SET ${sets.join(', ')} WHERE id = $${i} AND empresa_id = $${i + 1} ${filtro} RETURNING *`,
        valores
    );

    return rows.length ? rows[0] : null;
}

async function getHistorico(id, empresa_id, somente_do_usuario) {
    const valores = [id, empresa_id];
    let filtro = '';

    if (somente_do_usuario !== undefined) {
        valores.push(somente_do_usuario);
        filtro = `AND EXISTS (SELECT 1 FROM clientes c WHERE c.id = v.cliente_id AND c.empresa_id = v.empresa_id AND c.criado_por = $3)`;
    }

    const { rows } = await db.query(`
        SELECT
          v.id AS venda_id,
          v.data,
          v.total AS total_venda,
          v.status AS status_venda,
          p.nome AS produto,
          iv.quantidade,
          iv.preco_unitario,
          (iv.quantidade * iv.preco_unitario) AS total_item
        FROM vendas v
        JOIN itens_venda iv ON iv.venda_id = v.id
        JOIN produtos p ON p.id = iv.produto_id
        WHERE v.cliente_id = $1 AND v.empresa_id = $2 ${filtro}
        ORDER BY v.data DESC
    `, valores);

    return rows;
}

async function getRanking(empresa_id, somente_do_usuario) {
    const valores = [empresa_id];
    let filtro = '';

    if (somente_do_usuario !== undefined) {
        valores.push(somente_do_usuario);
        filtro = 'AND c.criado_por = $2';
    }

    const { rows } = await db.query(`
        SELECT
          c.id,
          c.nome,
          COUNT(DISTINCT v.id) AS total_compras,
          COALESCE(SUM(v.total), 0) AS total_gasto,
          ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio
        FROM clientes c
        LEFT JOIN vendas v ON v.cliente_id = c.id AND v.empresa_id = c.empresa_id AND v.status = 'finalizada'
        WHERE c.empresa_id = $1 ${filtro}
        GROUP BY c.id, c.nome
        ORDER BY total_gasto DESC
    `, valores);

    return rows;
}

async function getTotalGasto(id, empresa_id, somente_do_usuario) {
    const valores = [id, empresa_id];
    let filtro = '';

    if (somente_do_usuario !== undefined) {
        valores.push(somente_do_usuario);
        filtro = 'AND c.criado_por = $3';
    }

    const { rows } = await db.query(`
        SELECT
          c.id,
          c.nome,
          COUNT(DISTINCT v.id) AS total_compras,
          COALESCE(SUM(v.total), 0) AS total_gasto,
          ROUND(COALESCE(AVG(v.total), 0), 2) AS ticket_medio
        FROM clientes c
        LEFT JOIN vendas v ON v.cliente_id = c.id AND v.empresa_id = c.empresa_id AND v.status = 'finalizada'
        WHERE c.id = $1 AND c.empresa_id = $2 ${filtro}
        GROUP BY c.id, c.nome
    `, valores);

    return rows.length ? rows[0] : null;
}

// Caso irregular (checa `anonimizado`, não `status`): usa executarComLock
// direto em vez de transicionarStatus, mesmo critério documentado em
// shared/transacoes.js.
async function anonimizar(id, empresa_id) {
    return executarComLock('clientes', { coluna: 'id', valor: id }, empresa_id, undefined, async (cliente, client) => {
        if (!cliente) {
            throw new AppError('Cliente não encontrado', 404);
        }

        if (cliente.anonimizado) {
            throw new AppError('Cliente já foi anonimizado', 409);
        }

        // Zera todo campo pessoal, incluindo os cadastrais adicionados nesta
        // issue e `observacoes` (texto livre — alto risco de conter dado
        // pessoal não estruturado, ex.: preferências, aniversário, endereço
        // de terceiro).
        const { rows } = await client.query(
            `UPDATE clientes SET
                nome = 'Cliente removido',
                telefone = NULL,
                email = NULL,
                cpf_cnpj = NULL,
                cep = NULL,
                endereco = NULL,
                numero = NULL,
                complemento = NULL,
                bairro = NULL,
                cidade = NULL,
                uf = NULL,
                data_nascimento = NULL,
                observacoes = NULL,
                ativo = false,
                anonimizado = true,
                anonimizado_em = NOW()
             WHERE id = $1
             RETURNING *`,
            [id]
        );

        return rows[0];
    });
}

module.exports = {
    listar,
    criar,
    buscarPorId,
    atualizar,
    getHistorico,
    getRanking,
    getTotalGasto,
    anonimizar
};
