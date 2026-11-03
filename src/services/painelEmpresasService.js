const crypto = require('node:crypto');
const db = require('../config/db');
const AppError = require('../errors/AppError');
const { criarEmpresaComAdmin } = require('./onboardingService');
const painelRepository = require('../repositories/painelRepository');

// Criação de empresa pelo Painel GiroNex (substitui o script de linha de comando com ONBOARDING_SECRET).
// O admin nasce com SENHA TEMPORÁRIA aleatória, mostrada uma vez ao operador para entregar ao cliente por um
// canal seguro; no primeiro acesso ele é obrigado a trocá-la. Nenhum token de acesso à loja é emitido aqui.
// Tudo numa transação: empresa + padrões + admin + evento na trilha do painel.

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function senhaTemporaria(tamanho = 12) {
    const bytes = crypto.randomBytes(tamanho);
    return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

async function criar(dados, operador, ip) {
    const senha = senhaTemporaria();
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const { empresa, usuario } = await criarEmpresaComAdmin(client, {
            ...dados,
            senha,
            senhaTemporaria: true
        });

        await painelRepository.registrarEvento({
            operador_id: operador.id,
            acao: 'empresa_criada',
            alvo_empresa_id: empresa.id,
            detalhe: { empresa: empresa.nome, admin_email: usuario.email, admin_login: usuario.login },
            ip
        }, client);

        await client.query('COMMIT');

        return {
            empresa: { id: empresa.id, nome: empresa.nome, status: empresa.status },
            admin: { id: usuario.id, nome: usuario.nome, email: usuario.email, login: usuario.login },
            senha_temporaria: senha
        };
    } catch (error) {
        await client.query('ROLLBACK');

        if (error.code === '23505' && error.constraint === 'usuarios_email_key') {
            throw new AppError('Já existe um usuário com este e-mail no Vertumno', 409);
        }

        throw error;
    } finally {
        client.release();
    }
}

module.exports = { criar, senhaTemporaria };
