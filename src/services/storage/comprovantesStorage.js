// Armazenamento PRIVADO dos comprovantes de pagamento da taxa da plataforma (Cloudflare R2, API S3).
//
// Diferente das fotos (imagensStorage): bucket sem acesso público, credencial própria restrita a ele e nenhum
// endereço público. O arquivo só sai pelo backend, para o operador do painel autenticado
// (GET /painel/taxas/lancamentos/:id/comprovante), e cada download vai para a trilha.
//
// Variáveis (opcionais para o backend subir; sem elas o envio de comprovante responde 412):
//   R2_ACCOUNT_ID                                     -> mesma conta das fotos (monta o endpoint)
//   R2_COMPROVANTES_BUCKET                            -> bucket privado dos comprovantes
//   R2_COMPROVANTES_ACCESS_KEY_ID / _SECRET_ACCESS_KEY -> token R2 restrito a ESTE bucket (Object Read & Write)
//
// O segredo nunca é logado nem devolvido.

const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

let cliente = null;
let chaveDoCliente = null;

function config(env = process.env) {
    return {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_COMPROVANTES_ACCESS_KEY_ID,
        secretAccessKey: env.R2_COMPROVANTES_SECRET_ACCESS_KEY,
        bucket: env.R2_COMPROVANTES_BUCKET
    };
}

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

async function enviar({ chave, buffer, contentType }, env = process.env) {
    await obterCliente(env).send(new PutObjectCommand({
        Bucket: config(env).bucket,
        Key: chave,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'private, no-store'
    }));
}

// true se o objeto existe; false se não existe (404). Outros erros sobem.
async function existe(chave, env = process.env) {
    try {
        await obterCliente(env).send(new HeadObjectCommand({ Bucket: config(env).bucket, Key: chave }));
        return true;
    } catch (erro) {
        if (erro?.$metadata?.httpStatusCode === 404 || erro?.name === 'NotFound') return false;
        throw erro;
    }
}

// { corpo (stream), contentType, tamanho }
async function obter(chave, env = process.env) {
    const r = await obterCliente(env).send(new GetObjectCommand({ Bucket: config(env).bucket, Key: chave }));
    return { corpo: r.Body, contentType: r.ContentType, tamanho: r.ContentLength };
}

module.exports = { configurado, enviar, existe, obter };
