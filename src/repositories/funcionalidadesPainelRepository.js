const db = require('../config/db');
const AppError = require('../errors/AppError');
const taxasPlataformaRepository = require('./taxasPlataformaRepository');
const painelRepository = require('./painelRepository');

// Funcionalidades por plano e por empresa, operadas só pelo Painel GiroNex (exceção deliberada ao
// empresa_id do JWT: a empresa-alvo vem da rota). As composições dos planos NÃO são editáveis aqui:
// mudam por migration versionada, como os próprios planos. Cada mudança de ligação grava a trilha
// (plataforma_eventos, só-inserção) na MESMA transação.

const HOJE_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

// Catálogo e o que cada plano inclui (leitura).
async function catalogo() {
    const { rows: funcionalidades } = await db.query(
        `SELECT codigo, nome, tipo, vendavel FROM funcionalidades ORDER BY tipo DESC, nome`
    );
    const { rows: planos } = await db.query(
        `SELECT p.codigo AS plano, COALESCE(array_agg(pf.funcionalidade ORDER BY pf.funcionalidade)
                FILTER (WHERE pf.funcionalidade IS NOT NULL), '{}') AS funcionalidades
         FROM planos_comerciais p
         LEFT JOIN plano_funcionalidades pf ON pf.plano_id = p.id
         GROUP BY p.codigo, p.id
         ORDER BY p.id`
    );

    return { funcionalidades, planos };
}

async function exigirEmpresa(client, empresa_id) {
    const { rows } = await client.query('SELECT id FROM empresas WHERE id = $1 FOR UPDATE', [empresa_id]);

    if (!rows.length) throw new AppError('Empresa não encontrada', 404);
}

// Situação de cada funcionalidade para a empresa: no plano, ligação e resultado efetivo
// (mesma regra da sessão: (plano OU ligada vigente) E NÃO desligada vigente).
async function listarDaEmpresa(empresa_id, client = db) {
    const { rows: empresa } = await client.query('SELECT id FROM empresas WHERE id = $1', [empresa_id]);

    if (!empresa.length) throw new AppError('Empresa não encontrada', 404);

    const plano = await taxasPlataformaRepository.buscarPlanoDaEmpresa(empresa_id, client);

    const { rows } = await client.query(
        `SELECT f.codigo, f.nome, f.tipo, f.vendavel,
                EXISTS (SELECT 1 FROM plano_funcionalidades pf WHERE pf.plano_id = $2 AND pf.funcionalidade = f.codigo) AS no_plano,
                ef.id AS ligacao_id, ef.ligada, ef.justificativa, ef.responsavel,
                ef.vigencia_inicio::text AS vigencia_inicio, ef.vigencia_fim::text AS vigencia_fim,
                (ef.id IS NOT NULL AND ef.vigencia_inicio <= ${HOJE_SQL}
                    AND (ef.vigencia_fim IS NULL OR ef.vigencia_fim >= ${HOJE_SQL})) AS ligacao_vigente
         FROM funcionalidades f
         LEFT JOIN empresa_funcionalidades ef ON ef.funcionalidade = f.codigo AND ef.empresa_id = $1
         ORDER BY f.tipo DESC, f.nome`,
        [empresa_id, plano.plano_id]
    );

    return {
        plano: plano.codigo,
        funcionalidades: rows.map((r) => {
            const efetiva = (r.no_plano || (r.ligacao_vigente && r.ligada === true))
                && !(r.ligacao_vigente && r.ligada === false);

            return {
                codigo: r.codigo,
                nome: r.nome,
                tipo: r.tipo,
                vendavel: r.vendavel,
                no_plano: r.no_plano,
                efetiva,
                ligacao: r.ligacao_id === null ? null : {
                    ligada: r.ligada,
                    vigente: r.ligacao_vigente,
                    vigencia_inicio: r.vigencia_inicio,
                    vigencia_fim: r.vigencia_fim,
                    justificativa: r.justificativa,
                    responsavel: r.responsavel
                }
            };
        })
    };
}

async function emTransacao(empresa_id, fn) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        await exigirEmpresa(client, empresa_id);
        const resultado = await fn(client);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function exigirFuncionalidade(client, codigo) {
    const { rows } = await client.query('SELECT codigo, vendavel FROM funcionalidades WHERE codigo = $1', [codigo]);

    if (!rows.length) throw new AppError('Funcionalidade não encontrada', 404);

    return rows[0];
}

// Liga ou desliga por empresa (uma linha por empresa+funcionalidade; a trilha guarda o histórico).
// Módulo ainda não construído (vendavel = false) não pode ser ligado; desligar sempre pode.
async function definirLigacao({ empresa_id, codigo, ligada, vigencia_inicio, vigencia_fim, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(empresa_id, async (client) => {
        const funcionalidade = await exigirFuncionalidade(client, codigo);

        if (ligada && !funcionalidade.vendavel) {
            throw new AppError('Esta funcionalidade ainda não está disponível para venda.', 409);
        }

        const { rows } = await client.query(
            `INSERT INTO empresa_funcionalidades
                (empresa_id, funcionalidade, ligada, justificativa, responsavel, vigencia_inicio, vigencia_fim)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, ${HOJE_SQL}), $7::date)
             ON CONFLICT (empresa_id, funcionalidade) DO UPDATE
                SET ligada = EXCLUDED.ligada, justificativa = EXCLUDED.justificativa, responsavel = EXCLUDED.responsavel,
                    vigencia_inicio = EXCLUDED.vigencia_inicio, vigencia_fim = EXCLUDED.vigencia_fim, atualizado_em = NOW()
             RETURNING vigencia_inicio::text AS vigencia_inicio, vigencia_fim::text AS vigencia_fim`,
            [empresa_id, codigo, ligada, justificativa, responsavel, vigencia_inicio ?? null, vigencia_fim ?? null]
        );

        await painelRepository.registrarEvento({
            operador_id,
            acao: ligada ? 'funcionalidade_ligada' : 'funcionalidade_desligada',
            alvo_empresa_id: empresa_id,
            detalhe: { funcionalidade: codigo, ligada, vigencia_inicio: rows[0].vigencia_inicio, vigencia_fim: rows[0].vigencia_fim, justificativa, responsavel },
            ip
        }, client);

        return listarDaEmpresa(empresa_id, client);
    });
}

// Remove a ligação: a funcionalidade volta a seguir só o plano.
async function removerLigacao({ empresa_id, codigo, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(empresa_id, async (client) => {
        await exigirFuncionalidade(client, codigo);

        const { rowCount } = await client.query(
            'DELETE FROM empresa_funcionalidades WHERE empresa_id = $1 AND funcionalidade = $2',
            [empresa_id, codigo]
        );

        if (rowCount === 0) throw new AppError('Não há ligação por empresa para remover.', 404);

        await painelRepository.registrarEvento({
            operador_id,
            acao: 'funcionalidade_ligacao_removida',
            alvo_empresa_id: empresa_id,
            detalhe: { funcionalidade: codigo, justificativa, responsavel },
            ip
        }, client);

        return listarDaEmpresa(empresa_id, client);
    });
}

module.exports = { catalogo, listarDaEmpresa, definirLigacao, removerLigacao };
