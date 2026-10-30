const db = require('../config/db');
const AppError = require('../errors/AppError');

// Administração comercial das empresas pelo OPERADOR DA PLATAFORMA (plataforma_admin).
// Exceção deliberada à regra "empresa_id vem do JWT": aqui a empresa-alvo vem da rota,
// e só quem passa por requirePlataformaAdmin chega. O responsável pelas mudanças vem do
// usuário autenticado, nunca do corpo da requisição.
//
// Transação ad hoc (e não executarComLock): `empresas` não tem coluna empresa_id, que o
// helper exige. O FOR UPDATE na linha da empresa serializa mudanças concorrentes da mesma
// empresa; a constraint de exclusão da 048 continua como última barreira.

const HOJE_SQL = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

const VIGENTE_SQL = (alias) => `${alias}.ativo = true
           AND ${alias}.vigencia_inicio <= ${HOJE_SQL}
           AND (${alias}.vigencia_fim IS NULL OR ${alias}.vigencia_fim >= ${HOJE_SQL})`;

async function hoje(client) {
    const { rows } = await client.query(`SELECT ${HOJE_SQL}::text AS hoje`);
    return rows[0].hoje;
}

async function listarPlanos() {
    const { rows } = await db.query(
        `SELECT p.id, p.codigo, p.nome, p.tem_mensalidade, p.ativo, pol.percentual::text AS percentual
         FROM planos_comerciais p
         LEFT JOIN LATERAL (
             SELECT t.percentual
             FROM politicas_taxa_plataforma t
             WHERE t.plano_id = p.id AND ${VIGENTE_SQL('t')}
             ORDER BY t.vigencia_inicio DESC, t.id DESC
             LIMIT 1
         ) pol ON true
         ORDER BY p.id`
    );

    return rows;
}

// Plano e condição vigentes de cada empresa (dados brutos). A regra efetiva é decidida pelo
// resolvedor de taxa, a mesma fonte usada na venda (service).
async function listarEmpresas() {
    const { rows } = await db.query(
        `SELECT e.id AS empresa_id, e.nome AS empresa_nome, e.status,
                ep.id AS plano_registro_id, pl.codigo AS plano_codigo, pl.nome AS plano_nome,
                pl.tem_mensalidade, ep.vigencia_inicio::text AS plano_inicio, ep.vigencia_fim::text AS plano_fim,
                c.id AS condicao_id, c.percentual::text AS condicao_percentual,
                c.vigencia_inicio::text AS condicao_inicio, c.vigencia_fim::text AS condicao_fim,
                c.justificativa AS condicao_justificativa, c.responsavel AS condicao_responsavel
         FROM empresas e
         LEFT JOIN LATERAL (
             SELECT * FROM empresa_planos ep
             WHERE ep.empresa_id = e.id AND ${VIGENTE_SQL('ep')}
             ORDER BY ep.vigencia_inicio DESC, ep.id DESC LIMIT 1
         ) ep ON true
         LEFT JOIN planos_comerciais pl ON pl.id = ep.plano_id
         LEFT JOIN LATERAL (
             SELECT * FROM condicoes_comerciais_empresa c
             WHERE c.empresa_id = e.id AND ${VIGENTE_SQL('c')}
             ORDER BY c.vigencia_inicio DESC, c.id DESC LIMIT 1
         ) c ON true
         ORDER BY e.nome ASC, e.id ASC`
    );

    return rows;
}

async function historico(empresa_id) {
    const { rows: empresa } = await db.query('SELECT id, nome FROM empresas WHERE id = $1', [empresa_id]);

    if (!empresa.length) throw new AppError('Empresa não encontrada', 404);

    const { rows: planos } = await db.query(
        `SELECT ep.id, pl.codigo AS plano_codigo, pl.nome AS plano_nome,
                ep.vigencia_inicio::text AS vigencia_inicio, ep.vigencia_fim::text AS vigencia_fim, ep.ativo,
                ep.justificativa, ep.responsavel, ep.criado_em,
                ep.encerrado_por, ep.encerrado_em, ep.motivo_encerramento
         FROM empresa_planos ep JOIN planos_comerciais pl ON pl.id = ep.plano_id
         WHERE ep.empresa_id = $1
         ORDER BY ep.vigencia_inicio DESC, ep.id DESC`,
        [empresa_id]
    );

    const { rows: condicoes } = await db.query(
        `SELECT c.id, c.percentual::text AS percentual,
                c.vigencia_inicio::text AS vigencia_inicio, c.vigencia_fim::text AS vigencia_fim, c.ativo,
                c.justificativa, c.responsavel, c.criado_em,
                c.encerrado_por, c.encerrado_em, c.motivo_encerramento
         FROM condicoes_comerciais_empresa c
         WHERE c.empresa_id = $1
         ORDER BY c.vigencia_inicio DESC, c.id DESC`,
        [empresa_id]
    );

    return { empresa: empresa[0], planos, condicoes };
}

async function emTransacao(empresa_id, callback) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query('SELECT id FROM empresas WHERE id = $1 FOR UPDATE', [empresa_id]);
        if (!rows.length) throw new AppError('Empresa não encontrada', 404);

        const resultado = await callback(client);
        await client.query('COMMIT');
        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');

        // Última barreira contra sobreposição de vigências (constraint de exclusão da 048).
        if (error.code === '23P01') {
            throw new AppError('Já existe um registro vigente que se sobrepõe a esse período.', 409);
        }

        throw error;
    } finally {
        client.release();
    }
}

async function exigirNaoPassado(client, inicio) {
    const dataHoje = await hoje(client);

    if (inicio < dataHoje) {
        throw new AppError('A vigência não pode começar no passado: vendas já feitas não são recalculadas.', 400);
    }

    return dataHoje;
}

// Troca o plano da empresa: encerra o plano vigente no dia anterior e cria o novo.
async function trocarPlano({ empresa_id, plano_codigo, vigencia_inicio, justificativa, responsavel }) {
    return emTransacao(empresa_id, async (client) => {
        const dataHoje = await hoje(client);
        const inicio = vigencia_inicio ?? dataHoje;
        await exigirNaoPassado(client, inicio);

        const { rows: planoRows } = await client.query(
            'SELECT id, codigo, ativo FROM planos_comerciais WHERE codigo = $1',
            [plano_codigo]
        );

        if (!planoRows.length) throw new AppError('Plano não encontrado', 404);
        if (!planoRows[0].ativo) throw new AppError('Plano inativo não pode ser atribuído', 409);

        // Sem política vigente na data, as vendas da empresa falhariam: bloqueia antes.
        const { rows: politicaRows } = await client.query(
            `SELECT 1 FROM politicas_taxa_plataforma
             WHERE plano_id = $1 AND ativo = true AND vigencia_inicio <= $2::date
               AND (vigencia_fim IS NULL OR vigencia_fim >= $2::date)
             LIMIT 1`,
            [planoRows[0].id, inicio]
        );

        if (!politicaRows.length) {
            throw new AppError('O plano não tem política de taxa vigente nessa data.', 409);
        }

        const { rows: abertos } = await client.query(
            `SELECT id, plano_id, vigencia_inicio::text AS vigencia_inicio
             FROM empresa_planos
             WHERE empresa_id = $1 AND ativo = true AND (vigencia_fim IS NULL OR vigencia_fim >= $2::date)
             ORDER BY vigencia_inicio`,
            [empresa_id, inicio]
        );

        const futuro = abertos.find((linha) => linha.vigencia_inicio > inicio);
        if (futuro) {
            throw new AppError(`Já existe plano agendado com início em ${futuro.vigencia_inicio}.`, 409);
        }

        // Início no mesmo dia do registro vigente = correção do mesmo dia: o registro é desativado
        // (nunca apagado). Início posterior: o vigente é encerrado no dia anterior.
        const atual = abertos.find((linha) => linha.vigencia_inicio === inicio) ?? abertos[0];
        if (atual && atual.plano_id === planoRows[0].id) {
            throw new AppError('A empresa já está nesse plano.', 409);
        }

        if (atual) {
            await client.query(
                atual.vigencia_inicio === inicio
                    ? `UPDATE empresa_planos
                       SET ativo = false, encerrado_por = $2, encerrado_em = NOW(), motivo_encerramento = $3
                       WHERE id = $1`
                    : `UPDATE empresa_planos
                       SET vigencia_fim = ($4::date - 1), encerrado_por = $2, encerrado_em = NOW(), motivo_encerramento = $3
                       WHERE id = $1`,
                atual.vigencia_inicio === inicio
                    ? [atual.id, responsavel, justificativa]
                    : [atual.id, responsavel, justificativa, inicio]
            );
        }

        const { rows } = await client.query(
            `INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, justificativa, responsavel)
             VALUES ($1, $2, $3::date, $4, $5)
             RETURNING id, empresa_id, plano_id, vigencia_inicio::text AS vigencia_inicio, vigencia_fim, ativo`,
            [empresa_id, planoRows[0].id, inicio, justificativa, responsavel]
        );

        return { ...rows[0], plano_codigo: planoRows[0].codigo, substituiu_id: atual?.id ?? null };
    });
}

// Define a condição individual (exceção negociada; 0% é válido). Substitui a vigente.
async function definirCondicao({ empresa_id, percentual, vigencia_inicio, vigencia_fim, justificativa, responsavel }) {
    return emTransacao(empresa_id, async (client) => {
        const dataHoje = await hoje(client);
        const inicio = vigencia_inicio ?? dataHoje;
        await exigirNaoPassado(client, inicio);

        if (vigencia_fim && vigencia_fim < inicio) {
            throw new AppError('O fim da vigência não pode ser anterior ao início.', 400);
        }

        const { rows: sobrepostas } = await client.query(
            `SELECT id, vigencia_inicio::text AS vigencia_inicio
             FROM condicoes_comerciais_empresa
             WHERE empresa_id = $1 AND ativo = true
               AND daterange(vigencia_inicio, vigencia_fim, '[]') && daterange($2::date, $3::date, '[]')
             ORDER BY vigencia_inicio`,
            [empresa_id, inicio, vigencia_fim ?? null]
        );

        const futura = sobrepostas.find((linha) => linha.vigencia_inicio > inicio);
        if (futura) {
            throw new AppError(`Já existe condição agendada com início em ${futura.vigencia_inicio}.`, 409);
        }

        // Mesmo dia = correção (desativa, sem apagar); início posterior = encerra a vigente no dia anterior.
        const atual = sobrepostas.find((linha) => linha.vigencia_inicio === inicio) ?? sobrepostas[0];

        if (atual) {
            await client.query(
                atual.vigencia_inicio === inicio
                    ? `UPDATE condicoes_comerciais_empresa
                       SET ativo = false, encerrado_por = $2, encerrado_em = NOW(), motivo_encerramento = $3
                       WHERE id = $1`
                    : `UPDATE condicoes_comerciais_empresa
                       SET vigencia_fim = ($4::date - 1), encerrado_por = $2, encerrado_em = NOW(), motivo_encerramento = $3
                       WHERE id = $1`,
                atual.vigencia_inicio === inicio
                    ? [atual.id, responsavel, justificativa]
                    : [atual.id, responsavel, justificativa, inicio]
            );
        }

        const { rows } = await client.query(
            `INSERT INTO condicoes_comerciais_empresa
                (empresa_id, tipo, percentual, vigencia_inicio, vigencia_fim, substitui_id, justificativa, responsavel)
             VALUES ($1, 'percentual', $2, $3::date, $4::date, $5, $6, $7)
             RETURNING id, empresa_id, percentual::text AS percentual,
                       vigencia_inicio::text AS vigencia_inicio, vigencia_fim::text AS vigencia_fim, ativo, substitui_id`,
            [empresa_id, percentual, inicio, vigencia_fim ?? null, atual?.id ?? null, justificativa, responsavel]
        );

        return rows[0];
    });
}

// Encerra a condição individual a partir de uma data (padrão: hoje). Se ela ainda nem
// começou a valer, é cancelada (ativo = false), sem apagar o registro.
async function encerrarCondicao({ empresa_id, a_partir_de, justificativa, responsavel }) {
    return emTransacao(empresa_id, async (client) => {
        const dataHoje = await hoje(client);
        const partir = a_partir_de ?? dataHoje;
        await exigirNaoPassado(client, partir);

        const { rows } = await client.query(
            `SELECT id, vigencia_inicio::text AS vigencia_inicio
             FROM condicoes_comerciais_empresa
             WHERE empresa_id = $1 AND ativo = true AND (vigencia_fim IS NULL OR vigencia_fim >= $2::date)
             ORDER BY vigencia_inicio
             LIMIT 1`,
            [empresa_id, dataHoje]
        );

        if (!rows.length) throw new AppError('A empresa não tem condição individual vigente ou agendada.', 404);

        const alvo = rows[0];
        const nuncaValeu = alvo.vigencia_inicio >= partir;

        const { rows: atualizadas } = await client.query(
            nuncaValeu
                ? `UPDATE condicoes_comerciais_empresa
                   SET ativo = false, encerrado_por = $2, encerrado_em = NOW(), motivo_encerramento = $3
                   WHERE id = $1
                   RETURNING id, vigencia_inicio::text AS vigencia_inicio, vigencia_fim::text AS vigencia_fim, ativo`
                : `UPDATE condicoes_comerciais_empresa
                   SET vigencia_fim = ($4::date - 1), encerrado_por = $2, encerrado_em = NOW(), motivo_encerramento = $3
                   WHERE id = $1
                   RETURNING id, vigencia_inicio::text AS vigencia_inicio, vigencia_fim::text AS vigencia_fim, ativo`,
            nuncaValeu ? [alvo.id, responsavel, justificativa] : [alvo.id, responsavel, justificativa, partir]
        );

        return atualizadas[0];
    });
}

module.exports = {
    listarPlanos,
    listarEmpresas,
    historico,
    trocarPlano,
    definirCondicao,
    encerrarCondicao
};
