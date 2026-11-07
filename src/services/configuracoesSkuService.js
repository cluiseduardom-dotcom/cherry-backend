const db = require('../config/db');
const configuracoesSkuRepository = require('../repositories/configuracoesSkuRepository');
const AppError = require('../errors/AppError');

async function listar(empresaId, escopo = 'produto') {
    return configuracoesSkuRepository.buscarAtiva(empresaId, undefined, escopo);
}

async function listarTodos(empresaId, escopo = 'produto') {
    return configuracoesSkuRepository.listar(empresaId, undefined, escopo);
}

async function validarSegmentos(segmentos, empresaId, client, escopo = 'produto') {
    const niveis = new Set();
    const ordens = new Set();

    for (const segmento of segmentos) {
        if (niveis.has(segmento.nivel)) {
            throw new AppError('Não é permitido repetir o mesmo nível na configuração do SKU', 400);
        }

        if (ordens.has(segmento.ordem)) {
            throw new AppError('Não é permitido repetir a ordem dos segmentos', 400);
        }

        niveis.add(segmento.nivel);
        ordens.add(segmento.ordem);
    }

    if (!segmentos.length) return;

    const { rows } = await client.query(
        `SELECT DISTINCT nivel
         FROM (
             SELECT nivel FROM niveis_categoria WHERE empresa_id = $1 AND escopo = $2
             UNION
             SELECT nivel FROM categorias_produto WHERE empresa_id = $1 AND escopo = $2 AND deletado_em IS NULL
         ) niveis
         ORDER BY nivel`,
        [empresaId, escopo]
    );

    const permitidos = new Set(rows.map((item) => Number(item.nivel)));
    const nivelInvalido = segmentos.find((segmento) => !permitidos.has(Number(segmento.nivel)));

    if (nivelInvalido) {
        throw new AppError(`Nível ${nivelInvalido.nivel} não existe para esta empresa`, 400);
    }
}

async function salvar(dados, empresaId) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const escopo = dados.escopo ?? 'produto';

        await validarSegmentos(dados.segmentos, empresaId, client, escopo);

        if (dados.padrao !== false) {
            await client.query(
                `UPDATE configuracoes_sku SET padrao = false, atualizado_em = NOW()
                 WHERE empresa_id = $1 AND ativo = true AND escopo = $2`,
                [empresaId, escopo]
            );
        }

        let config;
        if (dados.id) {
            config = await configuracoesSkuRepository.atualizar(
                dados.id,
                empresaId,
                dados,
                client
            );

            if (!config) {
                throw new AppError('Configuração de SKU não encontrada', 404);
            }
        } else {
            config = await configuracoesSkuRepository.criar({
                ...dados,
                empresa_id: empresaId
            }, client);
        }

        await configuracoesSkuRepository.substituirSegmentos(
            config.id,
            dados.segmentos,
            client
        );

        await client.query('COMMIT');

        return configuracoesSkuRepository.listar(empresaId, undefined, escopo);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { listar, listarTodos, salvar };
