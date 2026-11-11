const db = require('../config/db');
const AppError = require('../errors/AppError');
const { executarComLock } = require('./shared/transacoes');

const MAX_BANNERS = 6;
const LADOS = { esquerda: 'imagem_esquerda_chave', direita: 'imagem_direita_chave', centro: 'imagem_centro_chave' };
const CAMPOS_TEXTO = ['rotulo', 'titulo', 'destaque', 'subtitulo', 'botao_texto', 'link', 'rodape_texto'];
const COLUNAS = `id, ordem, ativo, usa_retrato, fundo, rotulo, titulo, destaque, subtitulo, botao_texto, link, rodape_texto,
    imagem_esquerda_chave, imagem_direita_chave, imagem_centro_chave, inicio_em, fim_em, atualizado_em`;

async function listar(empresa_id) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS} FROM loja_banners WHERE empresa_id = $1 AND removido_em IS NULL ORDER BY ordem, id`,
        [empresa_id]
    );
    return rows;
}

// Público: só a faixa ATIVA, com algo para mostrar e dentro da janela de datas (se houver).
async function listarPublicos(empresa_id) {
    const { rows } = await db.query(
        `SELECT ${COLUNAS} FROM loja_banners
          WHERE empresa_id = $1 AND removido_em IS NULL AND ativo = true
            AND (inicio_em IS NULL OR inicio_em <= NOW()) AND (fim_em IS NULL OR fim_em > NOW())
          ORDER BY ordem, id`,
        [empresa_id]
    );
    return rows;
}

async function buscar(id, empresa_id) {
    const { rows } = await db.query(`SELECT ${COLUNAS} FROM loja_banners WHERE id = $1 AND empresa_id = $2 AND removido_em IS NULL`, [id, empresa_id]);
    return rows[0] ?? null;
}

// Cria vazia e inativa, no fim da fila. No máximo MAX_BANNERS por empresa (a contagem e o INSERT são um comando só).
async function criar(empresa_id, usuario_id, dados) {
    const { rows } = await db.query(
        `INSERT INTO loja_banners (empresa_id, criado_por, ordem, fundo, usa_retrato, rotulo, titulo, destaque, subtitulo, botao_texto, link, rodape_texto, inicio_em, fim_em)
         SELECT $1, $2, COALESCE((SELECT MAX(ordem) + 1 FROM loja_banners WHERE empresa_id = $1 AND removido_em IS NULL), 0),
                $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
          WHERE (SELECT COUNT(*) FROM loja_banners WHERE empresa_id = $1 AND removido_em IS NULL) < ${MAX_BANNERS}
         RETURNING id`,
        [empresa_id, usuario_id, dados.fundo ?? 'vinho', dados.usa_retrato ?? false, dados.rotulo ?? null, dados.titulo ?? null, dados.destaque ?? null,
            dados.subtitulo ?? null, dados.botao_texto ?? null, dados.link ?? null, dados.rodape_texto ?? null, dados.inicio_em ?? null, dados.fim_em ?? null]
    );

    if (!rows.length) throw new AppError(`São no máximo ${MAX_BANNERS} faixas. Remova uma para criar outra`, 409);

    return buscar(rows[0].id, empresa_id);
}

function regrasDoConjunto(f) {
    if (f.botao_texto && !f.link) throw new AppError('O botão precisa de um link', 400);
    if (f.inicio_em && f.fim_em && new Date(f.fim_em) <= new Date(f.inicio_em)) throw new AppError('A data de fim deve ser depois da de início', 400);

    const temConteudo = f.usa_retrato || f.titulo || f.destaque || f.subtitulo || f.imagem_esquerda_chave || f.imagem_direita_chave || f.imagem_centro_chave;
    if (f.ativo && !temConteudo) throw new AppError('Preencha ao menos um texto ou uma imagem antes de ativar a faixa', 409);
}

async function atualizar(id, empresa_id, dados) {
    await executarComLock('loja_banners', { coluna: 'id', valor: id }, empresa_id, null, async (linha, client) => {
        if (!linha || linha.removido_em) throw new AppError('Faixa não encontrada', 404);

        const final = { ...linha, ...dados };
        regrasDoConjunto(final);

        await client.query(
            `UPDATE loja_banners SET ativo = $3, usa_retrato = $4, fundo = $5, ordem = $6, rotulo = $7, titulo = $8, destaque = $9, subtitulo = $10,
                    botao_texto = $11, link = $12, rodape_texto = $13, inicio_em = $14, fim_em = $15, atualizado_em = NOW()
              WHERE id = $1 AND empresa_id = $2`,
            [id, empresa_id, final.ativo, final.usa_retrato, final.fundo, final.ordem, final.rotulo, final.titulo, final.destaque, final.subtitulo,
                final.botao_texto, final.link, final.rodape_texto, final.inicio_em, final.fim_em]
        );
    });

    return buscar(id, empresa_id);
}

// Troca a imagem de um lado; devolve a chave ANTIGA (para sair do armazenamento) ou null.
async function definirImagem(id, empresa_id, lado, chave) {
    const coluna = LADOS[lado];

    return executarComLock('loja_banners', { coluna: 'id', valor: id }, empresa_id, null, async (linha, client) => {
        if (!linha || linha.removido_em) throw new AppError('Faixa não encontrada', 404);

        // Tirar a imagem de uma faixa ativa que fica sem nada para mostrar não é permitido (o banco também barra).
        if (chave === null) regrasDoConjunto({ ...linha, [coluna]: null });

        await client.query(`UPDATE loja_banners SET ${coluna} = $3, atualizado_em = NOW() WHERE id = $1 AND empresa_id = $2`, [id, empresa_id, chave]);

        return linha[coluna] ?? null;
    });
}

// Remove: marca removido_em e devolve as chaves das imagens (para saírem do armazenamento).
async function remover(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE loja_banners SET removido_em = NOW(), ativo = false, atualizado_em = NOW()
          WHERE id = $1 AND empresa_id = $2 AND removido_em IS NULL RETURNING imagem_esquerda_chave, imagem_direita_chave, imagem_centro_chave`,
        [id, empresa_id]
    );

    if (!rows.length) throw new AppError('Faixa não encontrada', 404);

    return [rows[0].imagem_esquerda_chave, rows[0].imagem_direita_chave, rows[0].imagem_centro_chave].filter(Boolean);
}

module.exports = { listar, listarPublicos, buscar, criar, atualizar, definirImagem, remover, MAX_BANNERS, LADOS, CAMPOS_TEXTO };
