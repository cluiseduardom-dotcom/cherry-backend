const db = require('../config/db');
const configuracoesSkuRepository = require('../repositories/configuracoesSkuRepository');
const niveisCategoriaRepository = require('../repositories/niveisCategoriaRepository');
const categoriasRepository = require('../repositories/categoriasRepository');
const AppError = require('../errors/AppError');

async function listar(empresaId) {
    return configuracoesSkuRepository.buscarAtiva(empresaId);
}

async function validarSegmentos(segmentos, empresaId, client) {
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

    const niveisExistentes = await niveisCategoriaRepository.listar(empresaId, client);
    const categorias = await categoriasRepository.buscarNiveis(empresaId, client);

    const permitidos = new Set([
        ...niveisExistentes.map((item) => Number(item.nivel)),
        ...categorias.map((item) => Number(item.nivel))
    ]);

    const nivelInvalido = segmentos.find((segmento) => !permitidos.has(Number(segmento.nivel)));

    if (nivelInvalido) {
        throw new AppError(`Nível ${nivelInvalido.nivel} não existe para esta empresa`, 400);
    }
}

async function salvar(dados, empresaId) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        let config = await configuracoesSkuRepository.buscarAtiva(empresaId, client);

        await validarSegmentos(dados.segmentos, empresaId, client);

        if (!config) {
            config = await configuracoesSkuRepository.criar({
                ...dados,
                empresa_id: empresaId
            }, client);
        } else {
            config = await configuracoesSkuRepository.atualizar(
                config.id,
                empresaId,
                dados,
                client
            );

            if (!config) {
                throw new AppError('Configuração de SKU não encontrada', 404);
            }
        }

        await configuracoesSkuRepository.substituirSegmentos(
            config.id,
            dados.segmentos,
            client
        );

        await client.query('COMMIT');

        return configuracoesSkuRepository.buscarAtiva(empresaId);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { listar, salvar };
