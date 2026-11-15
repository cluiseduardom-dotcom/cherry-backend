const db = require('../config/db');
const AppError = require('../errors/AppError');
const painelRepository = require('./painelRepository');

// Bloqueio de Pix por empresa (migration 116). Duas frentes:
//  * TENANT (venda): pixManualBloqueado(empresa_id, client), sempre pela empresa do JWT, na transação da venda.
//    Nunca devolve motivo nem justificativa ao cliente da loja.
//  * PAINEL (operador): bloquear / liberar o Pix manual de uma empresa (a empresa-alvo vem da rota: exceção deliberada),
//    com justificativa e trilha em plataforma_eventos na MESMA transação. O responsável é sempre o operador da sessão.

const MOTIVO_PIX_MANUAL = 'pix_manual_sinalizado';

// Pix lançado à mão (sem cobrança do Mercado Pago) fica recusado com qualquer bloqueio ativo: o do operador
// (pix_manual_sinalizado) e, quando existir, a suspensão por taxa (suspensao_taxa), que atinge todo o Pix.
async function pixManualBloqueado(empresa_id, client = db) {
    const { rows } = await client.query(
        'SELECT 1 FROM bloqueios_pix_empresa WHERE empresa_id = $1 AND liberado_em IS NULL LIMIT 1',
        [empresa_id]
    );

    return rows.length > 0;
}

async function emTransacao(fn) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');
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

async function exigirEmpresa(client, empresa_id) {
    const { rows } = await client.query('SELECT id FROM empresas WHERE id = $1', [empresa_id]);
    if (!rows.length) throw new AppError('Empresa não encontrada', 404);
}

// Sinaliza a empresa e bloqueia o lançamento de Pix manual. Um só bloqueio ativo por empresa (índice único parcial):
// repetir responde 409 em vez de duplicar.
async function bloquearPixManual({ empresa_id, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(async (client) => {
        await exigirEmpresa(client, empresa_id);

        let bloqueio;
        try {
            const { rows } = await client.query(
                `INSERT INTO bloqueios_pix_empresa (empresa_id, motivo, justificativa, aberto_por, aberto_por_operador_id)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, empresa_id, motivo, justificativa, aberto_por, aberto_em`,
                [empresa_id, MOTIVO_PIX_MANUAL, justificativa, responsavel, operador_id ?? null]
            );
            bloqueio = rows[0];
        } catch (error) {
            if (error.code === '23505') throw new AppError('O Pix manual desta empresa já está bloqueado.', 409);
            throw error;
        }

        await painelRepository.registrarEvento({
            operador_id,
            acao: 'pix_manual_bloqueado',
            alvo_empresa_id: empresa_id,
            detalhe: { bloqueio_id: bloqueio.id, justificativa, responsavel },
            ip
        }, client);

        return bloqueio;
    });
}

// Libera o Pix manual (ação do admin, com justificativa). Só o bloqueio do operador; a suspensão por taxa não se libera aqui.
async function liberarPixManual({ empresa_id, justificativa, responsavel, operador_id, ip }) {
    return emTransacao(async (client) => {
        await exigirEmpresa(client, empresa_id);

        const { rows } = await client.query(
            `UPDATE bloqueios_pix_empresa
                SET liberado_em = NOW(), liberado_por = $3, liberado_por_operador_id = $4, justificativa_liberacao = $5
              WHERE empresa_id = $1 AND motivo = $2 AND liberado_em IS NULL
              RETURNING id, empresa_id, motivo, aberto_por, aberto_em, liberado_em, liberado_por`,
            [empresa_id, MOTIVO_PIX_MANUAL, responsavel, operador_id ?? null, justificativa]
        );

        if (!rows.length) throw new AppError('O Pix manual desta empresa não está bloqueado.', 409);

        await painelRepository.registrarEvento({
            operador_id,
            acao: 'pix_manual_liberado',
            alvo_empresa_id: empresa_id,
            detalhe: { bloqueio_id: rows[0].id, justificativa, responsavel },
            ip
        }, client);

        return rows[0];
    });
}

module.exports = { MOTIVO_PIX_MANUAL, pixManualBloqueado, bloquearPixManual, liberarPixManual };
