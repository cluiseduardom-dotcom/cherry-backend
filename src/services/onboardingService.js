const bcrypt = require('bcrypt');
const tokenService = require('./tokenService');
const db = require('../config/db');
const AppError = require('../errors/AppError');
const { gerarLoginBase } = require('../utils/loginUsuario');

// Núcleo da criação de empresa, dentro da transação do chamador: empresa, canais, configurações e o admin.
// `senhaTemporaria`: o admin é obrigado a trocar a senha no primeiro acesso (criação pelo Painel GiroNex).
async function criarEmpresaComAdmin(client, { empresa_nome, cnpj, nome_admin, email_admin, senha, senhaTemporaria = false }) {
    const empresaResult = await client.query(
        `INSERT INTO empresas (nome, cnpj, status)
         VALUES ($1, $2, 'ativa')
         RETURNING id, nome, cnpj, status`,
        [empresa_nome, cnpj || null]
    );

    const empresa = empresaResult.rows[0];

    await client.query(
        `INSERT INTO canais_venda (empresa_id, nome, ativo)
         VALUES ($1, 'loja_fisica', true), ($1, 'online', true)`,
        [empresa.id]
    );

    await client.query(
        `INSERT INTO configuracoes_financeiras (empresa_id)
         VALUES ($1)`,
        [empresa.id]
    );

    await client.query(
        `INSERT INTO configuracoes_sku
         (empresa_id, nome, tipo_sku, separador, prefixo, sufixo, tamanho_sequencia, inicio_sequencia, ativo)
         VALUES ($1, 'Padrão', 'numerico', '-', '', '', 3, 1, true)`,
        [empresa.id]
    );

    // Insumos têm categorização e padrão de SKU próprios: Família (obrigatória) + Tamanho (opcional) e as
    // famílias iniciais EMB, ETQ e MAT, que a empresa edita depois (mesma carga da migration 094).
    const { rows: [configInsumo] } = await client.query(
        `INSERT INTO configuracoes_sku
         (empresa_id, nome, tipo_sku, separador, prefixo, sufixo, tamanho_sequencia, inicio_sequencia, ativo, padrao, escopo)
         VALUES ($1, 'Insumos', 'numerico', '-', '', '', 3, 1, true, true, 'insumo')
         RETURNING id`,
        [empresa.id]
    );
    await client.query(
        `INSERT INTO configuracoes_sku_segmentos (configuracao_id, nivel, ordem, nome, obrigatorio, participa_sku)
         VALUES ($1, 1, 1, 'Família', true, true), ($1, 2, 2, 'Tamanho', false, true)`,
        [configInsumo.id]
    );
    await client.query(
        `INSERT INTO niveis_categoria (empresa_id, nivel, nome, escopo)
         VALUES ($1, 1, 'Família', 'insumo'), ($1, 2, 'Tamanho', 'insumo')`,
        [empresa.id]
    );
    await client.query(
        `INSERT INTO categorias_produto (empresa_id, nivel, codigo, nome, configuracao_sku_id, escopo)
         VALUES ($1, 1, 'EMB', 'Embalagem', $2, 'insumo'),
                ($1, 1, 'ETQ', 'Etiqueta / Tag', $2, 'insumo'),
                ($1, 1, 'MAT', 'Material', $2, 'insumo')`,
        [empresa.id, configInsumo.id]
    );

    // A senha só é processada depois dos padrões: uma falha antes não paga o bcrypt.
    const senhaHash = await bcrypt.hash(senha, 10);

    const usuarioResult = await client.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha, papel, login, senha_temporaria)
         VALUES ($1, $2, $3, $4, 'admin', $5, $6)
         RETURNING id, nome, email, login, papel, empresa_id`,
        [empresa.id, nome_admin, email_admin, senhaHash, gerarLoginBase(nome_admin), senhaTemporaria]
    );

    return { empresa, usuario: usuarioResult.rows[0] };
}

async function criarTenant({ empresa_nome, cnpj, nome_admin, email_admin, senha_admin }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { empresa, usuario } = await criarEmpresaComAdmin(client, { empresa_nome, cnpj, nome_admin, email_admin, senha: senha_admin });

        const token = tokenService.emitirToken(usuario);

        await client.query('COMMIT');

        return { token, empresa, usuario };
    } catch (error) {
        await client.query('ROLLBACK');

        if (error.code === '23505' && error.constraint === 'usuarios_email_key') {
            throw new AppError('Email do administrador já cadastrado', 409);
        }

        throw error;
    } finally {
        client.release();
    }
}

module.exports = { criarTenant, criarEmpresaComAdmin };
