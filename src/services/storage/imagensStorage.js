// Armazenamento das fotos de produto no Cloudflare R2 (API compatível com S3).
//
// Configuração por variável de ambiente (nenhuma é obrigatória para o backend subir; sem elas o upload
// responde 412 com mensagem clara e as telas seguem com o placeholder):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET  -> acesso ao bucket
//   R2_PUBLIC_BASE_URL                                                 -> base pública das fotos (sem barra final)
//
// O segredo nunca é logado nem devolvido pela API. Este módulo é a única fronteira com o provedor, então
// trocar de provedor mexe só aqui.

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

let cliente = null;
let chaveDoCliente = null;

function config(env = process.env) {
    return {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
        publicBaseUrl: (env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
    };
}

// Pode gravar/apagar objetos? (credenciais e bucket presentes)
function configurado(env = process.env) {
    const c = config(env);
    return Boolean(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket);
}

function obterCliente(env = process.env) {
    const c = config(env);
    const assinatura = `${c.accountId}|${c.accessKeyId}`;

    if (!cliente || chaveDoCliente !== assinatura) {
        cliente = new S3Client({
            region: 'auto',
            endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey }
        });
        chaveDoCliente = assinatura;
    }

    return cliente;
}

// URL pública da foto, ou null enquanto a base pública não estiver configurada.
function urlPublica(chave, env = process.env) {
    const { publicBaseUrl } = config(env);
    if (!publicBaseUrl || !chave) return null;
    return `${publicBaseUrl}/${chave}`;
}

async function enviar({ chave, buffer, contentType }, env = process.env) {
    await obterCliente(env).send(new PutObjectCommand({
        Bucket: config(env).bucket,
        Key: chave,
        Body: buffer,
        ContentType: contentType,
        // Nome do arquivo é aleatório e nunca reutilizado, então o cache pode ser longo.
        CacheControl: 'public, max-age=31536000, immutable'
    }));
}

async function remover(chave, env = process.env) {
    await obterCliente(env).send(new DeleteObjectCommand({
        Bucket: config(env).bucket,
        Key: chave
    }));
}

module.exports = { configurado, urlPublica, enviar, remover };
