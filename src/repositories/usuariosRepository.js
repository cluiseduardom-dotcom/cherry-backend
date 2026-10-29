const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');
const cargosRepository = require('./cargosRepository');
const { resolverCargo } = require('../services/permissoesService');

// Colunas que o service precisa para resolver o cargo EFETIVO de cada usuário (cargo do
// catálogo + linha de cargos_empresa + admin concedido), as mesmas que sessaoRepository usa.
// Filtra SEMPRE por empresa_id. Nunca devolve a senha.
const COLUNAS_COM_CARGO = `
    u.id, u.nome, u.email, u.papel, u.ativo, u.criado_em,
    (c.empresa_id IS NOT NULL) AS cargo_configurado,
    c.nivel AS cargo_nivel, c.ativo AS cargo_ativo, c.capacidades AS cargo_capacidades,
    EXISTS (
        SELECT 1 FROM usuario_privilegios p
        WHERE p.empresa_id = u.empresa_id AND p.usuario_id = u.id
          AND p.capacidade = 'administrador' AND p.revogado_em IS NULL
    ) AS administrador_concedido`;

const JOIN_CARGO = `
    LEFT JOIN cargos_empresa c ON c.empresa_id = u.empresa_id AND c.cargo = u.papel`;

// Dados cadastrais (usuarios_dados). Datas saem como 'YYYY-MM-DD' (to_char), nunca como Date.
const CAMPOS_DADOS = ['telefone', 'cpf', 'data_nascimento', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'data_admissao', 'observacoes'];
const COLUNAS_DADOS = `
    d.telefone, d.cpf, to_char(d.data_nascimento, 'YYYY-MM-DD') AS data_nascimento,
    d.cep, d.logradouro, d.numero, d.complemento, d.bairro, d.cidade, d.uf,
    to_char(d.data_admissao, 'YYYY-MM-DD') AS data_admissao, d.observacoes`;
const JOIN_DADOS = `
    LEFT JOIN usuarios_dados d ON d.usuario_id = u.id AND d.empresa_id = u.empresa_id`;
const JOIN_FOTO = `
    LEFT JOIN usuarios_fotos f ON f.usuario_id = u.id AND f.empresa_id = u.empresa_id`;

async function listarPorEmpresa(empresa_id) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS_COM_CARGO}, d.telefone, f.chave AS foto_chave
         FROM usuarios u
         ${JOIN_CARGO}
         ${JOIN_DADOS}
         ${JOIN_FOTO}
         WHERE u.empresa_id = $1
         ORDER BY u.nome ASC, u.id ASC`,
        [empresa_id]
    );

    return rows;
}

// Cria o usuário e grava o evento na MESMA transação: sem trilha, não há usuário.
// O cargo é REVALIDADO aqui dentro, sob a trava de cargo: se alguém o desligar ao mesmo tempo,
// a criação vê o cargo desligado e recusa (409) em vez de deixar um usuário ativo sem acesso.
// O e-mail é único no banco inteiro; a corrida entre duas criações vira 409, não 500.
async function criarComAuditoria({ nome, email, senhaHash, papel, empresa_id, executado_por, motivo, dados = {} }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
        await cargosRepository.travarCargo(client, empresa_id, papel);

        const cargo = resolverCargo(papel, await cargosRepository.buscar(empresa_id, papel, client));

        if (!cargo || !cargo.ativo) {
            throw new AppError('Cargo não habilitado neste comércio', 409);
        }

        const { rows } = await client.query(
            `INSERT INTO usuarios (nome, email, senha, papel, empresa_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, nome, email, papel, empresa_id, ativo`,
            [nome, email, senhaHash, papel, empresa_id]
        );

        await client.query(
            `INSERT INTO usuarios_dados (usuario_id, empresa_id, ${CAMPOS_DADOS.join(', ')}, atualizado_por)
             VALUES ($1, $2, ${CAMPOS_DADOS.map((_, i) => `$${i + 3}`).join(', ')}, $${CAMPOS_DADOS.length + 3})`,
            [rows[0].id, empresa_id, ...CAMPOS_DADOS.map((c) => dados[c] ?? null), executado_por]
        );

        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo)
             VALUES ($1, 'criar', $2, $3, $4, $5)`,
            [empresa_id, rows[0].id, papel, executado_por, motivo ?? null]
        );

        await client.query('COMMIT');

        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');

        if (error && error.code === '23505') {
            throw new AppError(error.constraint === 'uq_usuarios_dados_cpf' ? 'CPF já cadastrado nesta empresa' : 'Email já cadastrado', 409);
        }

        throw error;
    } finally {
        client.release();
    }
}

// Bloqueia/desbloqueia com a linha do usuário TRAVADA (FOR UPDATE, filtrada por empresa_id):
// a checagem de hierarquia e a escrita acontecem sobre o mesmo estado, sem corrida.
// `autorizar(alvo)` recebe o usuário já com o cargo efetivo e lança erro se o ator não puder.
// Bloqueio sobe token_version: todas as sessões já emitidas caem na próxima requisição.
// Repetir o mesmo estado é no-op (sem novo evento).
async function alterarBloqueio({ empresa_id, usuario_id, bloqueado, motivo, executado_por, autorizar }) {
    return executarComLock('usuarios', { coluna: 'id', valor: usuario_id }, empresa_id, undefined, async (linha, client) => {
        if (!linha) {
            throw new AppError('Usuário não encontrado', 404);
        }

        const { rows } = await client.query(
            `SELECT ${COLUNAS_COM_CARGO}
             FROM usuarios u
             ${JOIN_CARGO}
             WHERE u.id = $1 AND u.empresa_id = $2`,
            [usuario_id, empresa_id]
        );

        const alvo = rows[0];

        autorizar(alvo);

        const ativoDesejado = !bloqueado;

        if (alvo.ativo === ativoDesejado) {
            return { id: alvo.id, nome: alvo.nome, email: alvo.email, papel: alvo.papel, ativo: alvo.ativo, alterado: false };
        }

        const { rows: atualizados } = await client.query(
            bloqueado
                ? `UPDATE usuarios SET ativo = false, token_version = token_version + 1
                   WHERE id = $1 AND empresa_id = $2
                   RETURNING id, nome, email, papel, ativo`
                : `UPDATE usuarios SET ativo = true
                   WHERE id = $1 AND empresa_id = $2
                   RETURNING id, nome, email, papel, ativo`,
            [usuario_id, empresa_id]
        );

        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [empresa_id, bloqueado ? 'bloquear' : 'desbloquear', usuario_id, alvo.papel, executado_por, motivo]
        );

        return { ...atualizados[0], alterado: true };
    });
}

async function listarEventos({ empresa_id, limit, offset }) {
    const { rows } = await db.query(
        `SELECT e.id, e.acao, e.alvo_usuario_id, alvo.nome AS alvo_nome, e.cargo_alvo,
                e.executado_por, autor.nome AS executado_por_nome, e.motivo, e.campos, e.criado_em,
                fa.chave AS alvo_foto_chave, fe.chave AS executado_por_foto_chave
         FROM usuarios_eventos e
         JOIN usuarios alvo ON alvo.id = e.alvo_usuario_id AND alvo.empresa_id = e.empresa_id
         JOIN usuarios autor ON autor.id = e.executado_por AND autor.empresa_id = e.empresa_id
         LEFT JOIN usuarios_fotos fa ON fa.usuario_id = alvo.id AND fa.empresa_id = alvo.empresa_id
         LEFT JOIN usuarios_fotos fe ON fe.usuario_id = autor.id AND fe.empresa_id = autor.empresa_id
         WHERE e.empresa_id = $1
         ORDER BY e.criado_em DESC, e.id DESC
         LIMIT $2 OFFSET $3`,
        [empresa_id, limit, offset]
    );

    const { rows: totalRows } = await db.query(
        `SELECT COUNT(*) AS total FROM usuarios_eventos WHERE empresa_id = $1`,
        [empresa_id]
    );

    return { items: rows, total: Number(totalRows[0].total) };
}

// Detalhe com os dados cadastrais (inclui CPF: só chamar depois de autorizar o ator).
async function obterDetalhe(empresa_id, usuario_id, client = db) {
    const { rows } = await client.query(
        `SELECT ${COLUNAS_COM_CARGO}, ${COLUNAS_DADOS}, f.chave AS foto_chave
         FROM usuarios u
         ${JOIN_CARGO}
         ${JOIN_DADOS}
         ${JOIN_FOTO}
         WHERE u.id = $1 AND u.empresa_id = $2`,
        [usuario_id, empresa_id]
    );

    return rows[0] || null;
}

// Edita os dados cadastrais com a linha do usuário TRAVADA. `autorizar(alvo)` decide se o ator
// pode; `dados` traz só os campos enviados (null limpa). Sem mudança real = no-op (sem evento).
// A trilha guarda só os NOMES dos campos alterados, nunca os valores (CPF é dado pessoal).
async function editarDados({ empresa_id, usuario_id, dados, executado_por, autorizar }) {
    return executarComLock('usuarios', { coluna: 'id', valor: usuario_id }, empresa_id, undefined, async (linha, client) => {
        if (!linha) {
            throw new AppError('Usuário não encontrado', 404);
        }

        const alvo = await obterDetalhe(empresa_id, usuario_id, client);

        autorizar(alvo);

        const enviados = CAMPOS_DADOS.filter((campo) => Object.prototype.hasOwnProperty.call(dados, campo));
        const alterados = enviados.filter((campo) => (alvo[campo] ?? null) !== (dados[campo] ?? null));

        if (alterados.length === 0) {
            return { alterado: false, campos: [] };
        }

        try {
            await client.query(
                `INSERT INTO usuarios_dados (usuario_id, empresa_id, ${alterados.join(', ')}, atualizado_por)
                 VALUES ($1, $2, ${alterados.map((_, i) => `$${i + 3}`).join(', ')}, $${alterados.length + 3})
                 ON CONFLICT (usuario_id) DO UPDATE SET
                    ${alterados.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
                    atualizado_por = EXCLUDED.atualizado_por, atualizado_em = NOW()`,
                [usuario_id, empresa_id, ...alterados.map((c) => dados[c] ?? null), executado_por]
            );
        } catch (error) {
            if (error && error.code === '23505') {
                throw new AppError('CPF já cadastrado nesta empresa', 409);
            }

            throw error;
        }

        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo, campos)
             VALUES ($1, 'editar', $2, $3, $4, NULL, $5)`,
            [empresa_id, usuario_id, alvo.papel, executado_por, alterados]
        );

        return { alterado: true, campos: alterados };
    });
}

// Redefinição por admin: trava o alvo (filtrado por empresa_id), grava o hash, marca a senha como
// temporária, avança token_version (derruba as sessões dele) e registra a trilha — tudo numa transação.
async function redefinirSenha({ alvo_id, empresa_id, senhaHash, executado_por }) {
    return executarComLock('usuarios', { coluna: 'id', valor: alvo_id }, empresa_id, null, async (alvo, client) => {
        if (!alvo) throw new AppError('Usuário não encontrado', 404);

        if (alvo.id === executado_por) {
            throw new AppError('Para trocar a sua própria senha use "Alterar senha"', 400);
        }

        await client.query(
            `UPDATE usuarios SET senha = $1, senha_temporaria = true, token_version = token_version + 1
             WHERE id = $2 AND empresa_id = $3`,
            [senhaHash, alvo.id, empresa_id]
        );

        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo, campos)
             VALUES ($1, 'editar', $2, $3, $4, NULL, ARRAY['senha'])`,
            [empresa_id, alvo.id, alvo.papel, executado_por]
        );

        return { id: alvo.id, nome: alvo.nome, email: alvo.email };
    });
}

module.exports = {
    redefinirSenha,
    obterDetalhe,
    editarDados,
    listarPorEmpresa,
    criarComAuditoria,
    alterarBloqueio,
    listarEventos
};
