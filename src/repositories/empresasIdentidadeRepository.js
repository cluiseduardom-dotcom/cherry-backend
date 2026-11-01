const db = require('../config/db');
const AppError = require('../errors/AppError');

// Identidade visual por empresa: tema e slug de login.
//
// Duas fronteiras diferentes:
// * buscarMarcaPorSlug: leitura PÚBLICA (sem login) e mínima, só o tema de uma empresa ATIVA.
//   Nunca devolve id, nome, e-mail nem qualquer dado de negócio.
// * listar/atualizar: exceção deliberada ao empresa_id do JWT, restrita ao operador da plataforma
//   (a empresa-alvo vem da rota). `empresas` não tem empresa_id, então a transação é ad hoc, com
//   FOR UPDATE na linha da empresa para serializar mudanças concorrentes.

async function buscarMarcaPorSlug(slug) {
    const { rows } = await db.query(
        `SELECT slug, tema_visual FROM empresas WHERE slug = $1 AND status = 'ativa'`,
        [slug]
    );

    return rows[0] ?? null;
}

async function listar() {
    const { rows } = await db.query(
        `SELECT id AS empresa_id, nome AS empresa_nome, status, tema_visual, slug FROM empresas ORDER BY nome, id`
    );

    return rows;
}

async function historico(empresa_id) {
    const { rows } = await db.query(
        `SELECT id, tema_anterior, tema_novo, slug_anterior, slug_novo, responsavel, criado_em
         FROM empresas_identidade_eventos WHERE empresa_id = $1 ORDER BY criado_em DESC, id DESC`,
        [empresa_id]
    );

    return rows;
}

// `dados` traz só o que muda: tema_visual e/ou slug (slug null limpa). Sem mudança real, não grava evento.
async function atualizar({ empresa_id, tema_visual, slug, responsavel }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT id, nome, status, tema_visual, slug FROM empresas WHERE id = $1 FOR UPDATE',
            [empresa_id]
        );

        if (!rows.length) {
            throw new AppError('Empresa não encontrada', 404);
        }

        const atual = rows[0];
        const novoTema = tema_visual === undefined ? atual.tema_visual : tema_visual;
        const novoSlug = slug === undefined ? atual.slug : slug;

        if (novoTema === atual.tema_visual && novoSlug === atual.slug) {
            await client.query('COMMIT');
            return { ...atual, alterado: false };
        }

        try {
            await client.query('UPDATE empresas SET tema_visual = $1, slug = $2 WHERE id = $3', [novoTema, novoSlug, empresa_id]);
        } catch (error) {
            if (error.code === '23505') {
                throw new AppError('Este identificador já está em uso por outra empresa', 409);
            }
            throw error;
        }

        await client.query(
            `INSERT INTO empresas_identidade_eventos (empresa_id, tema_anterior, tema_novo, slug_anterior, slug_novo, responsavel)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [empresa_id, atual.tema_visual, novoTema, atual.slug, novoSlug, responsavel]
        );

        await client.query('COMMIT');

        return { id: atual.id, nome: atual.nome, status: atual.status, tema_visual: novoTema, slug: novoSlug, alterado: true };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { buscarMarcaPorSlug, listar, historico, atualizar };
