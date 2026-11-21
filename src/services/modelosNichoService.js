const AppError = require('../errors/AppError');
const { buscarModelo, MODELOS_NICHO, resumoDoModelo } = require('../constants/modelosNicho');

// Modelos prontos por nicho (níveis, categorias e padrão de SKU de PRODUTOS). Só como ponto de partida:
// a empresa edita tudo depois. Aplica-se numa empresa que ainda NÃO organizou as categorias de produto, dentro
// da transação de quem chama (criação da empresa ou rota do admin). Insumos não são tocados.

function listar() {
    return MODELOS_NICHO.map(resumoDoModelo);
}

async function aplicar(client, empresaId, modeloId) {
    const modelo = buscarModelo(modeloId);

    if (!modelo) throw new AppError('Modelo de nicho não encontrado', 404);

    // Serializa duas aplicações simultâneas na mesma empresa.
    await client.query('SELECT id FROM empresas WHERE id = $1 FOR UPDATE', [empresaId]);

    const { rows: [{ categorias }] } = await client.query(
        `SELECT COUNT(*)::int AS categorias FROM categorias_produto WHERE empresa_id = $1 AND escopo = 'produto' AND deletado_em IS NULL`,
        [empresaId]
    );

    if (categorias > 0) {
        throw new AppError('Esta empresa já tem categorias de produto. O modelo só pode ser aplicado antes de organizar as categorias.', 409);
    }

    // Padrão de SKU de produto da empresa (o que o onboarding cria, sem segmentos). Sem nenhum, cria.
    const { rows: configs } = await client.query(
        `SELECT id FROM configuracoes_sku WHERE empresa_id = $1 AND escopo = 'produto' AND ativo = true ORDER BY padrao DESC, id LIMIT 1`,
        [empresaId]
    );
    const { padrao_sku: padrao } = modelo;
    let configId;

    if (configs.length) {
        configId = configs[0].id;

        const { rows: [{ segmentos }] } = await client.query(
            'SELECT COUNT(*)::int AS segmentos FROM configuracoes_sku_segmentos WHERE configuracao_id = $1',
            [configId]
        );

        if (segmentos > 0) {
            throw new AppError('O padrão de SKU desta empresa já foi configurado. O modelo só pode ser aplicado antes disso.', 409);
        }

        await client.query(
            `UPDATE configuracoes_sku
                SET nome = $2, tipo_sku = $3, separador = $4, tamanho_sequencia = $5, inicio_sequencia = $6, padrao = true, atualizado_em = NOW()
              WHERE id = $1 AND empresa_id = $7`,
            [configId, padrao.nome, padrao.tipo_sku, padrao.separador, padrao.tamanho_sequencia, padrao.inicio_sequencia, empresaId]
        );
    } else {
        const { rows: [nova] } = await client.query(
            `INSERT INTO configuracoes_sku (empresa_id, nome, tipo_sku, separador, prefixo, sufixo, tamanho_sequencia, inicio_sequencia, ativo, padrao, escopo)
             VALUES ($1, $2, $3, $4, '', '', $5, $6, true, true, 'produto')
             RETURNING id`,
            [empresaId, padrao.nome, padrao.tipo_sku, padrao.separador, padrao.tamanho_sequencia, padrao.inicio_sequencia]
        );

        configId = nova.id;
    }

    for (const [indice, segmento] of padrao.segmentos.entries()) {
        await client.query(
            `INSERT INTO configuracoes_sku_segmentos (configuracao_id, nivel, ordem, nome, obrigatorio, participa_sku)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [configId, segmento.nivel, indice + 1, segmento.nome, segmento.obrigatorio, segmento.participa_sku]
        );
    }

    for (const nivel of modelo.niveis) {
        await client.query(
            `INSERT INTO niveis_categoria (empresa_id, nivel, nome, escopo) VALUES ($1, $2, $3, 'produto')
             ON CONFLICT (empresa_id, escopo, nivel) DO UPDATE SET nome = EXCLUDED.nome`,
            [empresaId, nivel.nivel, nivel.nome]
        );
    }

    for (const categoria of modelo.categorias) {
        await client.query(
            `INSERT INTO categorias_produto (empresa_id, nivel, codigo, nome, configuracao_sku_id, escopo)
             VALUES ($1, $2, $3, $4, $5, 'produto')`,
            [empresaId, categoria.nivel, categoria.codigo, categoria.nome, configId]
        );
    }

    return { modelo: modelo.id, niveis: modelo.niveis.length, categorias: modelo.categorias.length };
}

module.exports = { listar, aplicar };
