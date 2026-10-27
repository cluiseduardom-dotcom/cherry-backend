const crypto = require('node:crypto');
const AppError = require('../errors/AppError');
const { obterConfigMercadoPago } = require('../config/mercadoPagoConfig');
const { cifrar, decifrar } = require('../utils/criptografiaToken');
const mercadoPagoClient = require('../integrations/mercadoPagoClient');
const mercadoPagoRepository = require('../repositories/mercadoPagoRepository');
const { executarComLock } = require('../repositories/shared/transacoes');

const TTL_STATE_MINUTOS = 10;
// Renova o token quando faltam menos de 7 dias para vencer (vale 180 dias).
const MARGEM_RENOVACAO_MS = 7 * 24 * 3600 * 1000;

function exigirConfig() {
    const config = obterConfigMercadoPago();

    if (!config) {
        throw new AppError('A integração com o Mercado Pago não está configurada neste ambiente.', 409);
    }

    return config;
}

function expiracao(expiraEmSegundos) {
    return new Date(Date.now() + expiraEmSegundos * 1000);
}

async function obterStatus(empresa_id) {
    const configurado = obterConfigMercadoPago() !== null;
    const conexao = await mercadoPagoRepository.buscarConexao(empresa_id);

    return {
        configurado,
        conectado: Boolean(conexao?.ativo),
        conectado_em: conexao?.ativo ? conexao.conectado_em : null
    };
}

async function iniciarConexao(empresa_id, usuario_id) {
    const config = exigirConfig();
    const state = crypto.randomBytes(32).toString('hex');

    await mercadoPagoRepository.criarEstado({ state, empresa_id, usuario_id, ttlMinutos: TTL_STATE_MINUTOS });

    return { url: mercadoPagoClient.montarUrlAutorizacao(config, state) };
}

// Retorno do OAuth (sem JWT): a identidade vem do `state` gravado por nós, de uso único.
async function concluirConexao({ code, state }) {
    const config = exigirConfig();

    if (typeof code !== 'string' || !code || typeof state !== 'string' || !/^[0-9a-f]{64}$/.test(state)) {
        throw new AppError('Retorno de autorização inválido.', 400);
    }

    const estado = await mercadoPagoRepository.consumirEstado(state);

    if (!estado) {
        throw new AppError('Autorização expirada ou já utilizada. Inicie a conexão novamente.', 400);
    }

    const token = await mercadoPagoClient.trocarCodigo(config, code);

    await mercadoPagoRepository.salvarConexao({
        empresa_id: estado.empresa_id,
        mp_user_id: token.userId,
        accessCifrado: cifrar(token.accessToken, config.chaveCifra),
        refreshCifrado: token.refreshToken ? cifrar(token.refreshToken, config.chaveCifra) : null,
        expiraEm: expiracao(token.expiraEmSegundos),
        usuario_id: estado.usuario_id
    });
}

async function desconectar(empresa_id) {
    return mercadoPagoRepository.desativar(empresa_id);
}

// Token do vendedor (loja) pronto para uso, renovando-o antes de vencer. A renovação roda sob lock
// da linha: duas requisições simultâneas não gastam o mesmo refresh token.
async function obterAccessToken(empresa_id) {
    const config = exigirConfig();
    const conexao = await mercadoPagoRepository.buscarConexao(empresa_id);

    if (!conexao?.ativo || !conexao.access_token_cifrado) {
        throw new AppError('Conecte o Mercado Pago em Dados da empresa para receber por Pix.', 409);
    }

    const precisaRenovar = conexao.refresh_token_cifrado
        && conexao.token_expira_em
        && new Date(conexao.token_expira_em).getTime() - Date.now() < MARGEM_RENOVACAO_MS;

    if (!precisaRenovar) {
        return decifrar(conexao.access_token_cifrado, config.chaveCifra);
    }

    return executarComLock('empresa_mercadopago', { coluna: 'empresa_id', valor: empresa_id }, empresa_id, null, async (linha, client) => {
        if (!linha?.ativo) {
            throw new AppError('Conecte o Mercado Pago em Dados da empresa para receber por Pix.', 409);
        }

        // Outra requisição pode ter renovado enquanto esperávamos o lock.
        const aindaPrecisa = linha.token_expira_em
            && new Date(linha.token_expira_em).getTime() - Date.now() < MARGEM_RENOVACAO_MS;

        if (!aindaPrecisa) {
            return decifrar(linha.access_token_cifrado, config.chaveCifra);
        }

        try {
            const novo = await mercadoPagoClient.renovarToken(config, decifrar(linha.refresh_token_cifrado, config.chaveCifra));

            await mercadoPagoRepository.atualizarTokens({
                empresa_id,
                accessCifrado: cifrar(novo.accessToken, config.chaveCifra),
                refreshCifrado: novo.refreshToken ? cifrar(novo.refreshToken, config.chaveCifra) : linha.refresh_token_cifrado,
                expiraEm: expiracao(novo.expiraEmSegundos)
            }, client);

            return novo.accessToken;
        } catch (error) {
            // Se o token atual ainda vale, segue com ele; vencido, pede nova conexão.
            if (linha.token_expira_em && new Date(linha.token_expira_em).getTime() > Date.now()) {
                return decifrar(linha.access_token_cifrado, config.chaveCifra);
            }

            throw new AppError('A conexão com o Mercado Pago expirou. Reconecte em Dados da empresa.', 409);
        }
    });
}

module.exports = { obterStatus, iniciarConexao, concluirConexao, desconectar, obterAccessToken, exigirConfig };
