const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const AppError = require('../errors/AppError');

const JWT_EXPIRES_IN = '8h';

async function criarTenant({ empresa_nome, cnpj, nome_admin, email_admin, senha_admin }) {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

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

        const senhaHash = await bcrypt.hash(senha_admin, 10);

        const usuarioResult = await client.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel)
             VALUES ($1, $2, $3, $4, 'admin')
             RETURNING id, nome, email, papel, empresa_id`,
            [empresa.id, nome_admin, email_admin, senhaHash]
        );

        const usuario = usuarioResult.rows[0];

        const token = jwt.sign(
            { id: usuario.id, role: usuario.papel, empresa_id: usuario.empresa_id },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

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

module.exports = { criarTenant };
