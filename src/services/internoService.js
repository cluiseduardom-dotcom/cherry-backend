const db = require('../config/db');
const AppError = require('../errors/AppError');
const internoRepository = require('../repositories/internoRepository');

const EMPRESA_NAO_ENCONTRADA = 'Empresa não encontrada';

async function listarEmpresas() {
    return internoRepository.listarEmpresas(db);
}

async function definirTema({ empresa_id, tema, responsavel, justificativa }) {
    const empresa = await internoRepository.atualizarTema(db, empresa_id, tema);

    if (!empresa) {
        throw new AppError(EMPRESA_NAO_ENCONTRADA, 404);
    }

    // Trilha de auditoria operacional (sem segredo, sem corpo da requisição).
    console.info(JSON.stringify({
        evento: 'interno_tema_alterado', empresa_id, tema, responsavel, justificativa,
        timestamp: new Date().toISOString()
    }));

    return empresa;
}

// Estado do módulo e histórico imutável na MESMA transação: nunca um sem o outro.
async function definirModulo({ empresa_id, modulo, ativo, justificativa, responsavel }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        if (!(await internoRepository.empresaExiste(client, empresa_id))) {
            throw new AppError(EMPRESA_NAO_ENCONTRADA, 404);
        }

        const dados = { empresa_id, modulo, ativo, justificativa, responsavel };
        const resultado = await internoRepository.gravarModulo(client, dados);
        await internoRepository.registrarHistoricoModulo(client, dados);

        await client.query('COMMIT');

        return resultado;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { listarEmpresas, definirTema, definirModulo };
