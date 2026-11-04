// Sessão de operador do Painel GiroNex para testes de integração das rotas /painel/*.
// O JWT do painel usa segredo próprio (PAINEL_JWT_SECRET); define-se aqui, antes de o app ser carregado.
const crypto = require('node:crypto');

process.env.PAINEL_JWT_SECRET = process.env.PAINEL_JWT_SECRET || crypto.randomBytes(32).toString('hex');
process.env.PAINEL_ENC_KEY = process.env.PAINEL_ENC_KEY || crypto.randomBytes(32).toString('base64');

const db = require('../../src/config/db');
const painelAuthService = require('../../src/services/painelAuthService');

// Cria um operador já ativo (2FA ligado, sem senha temporária) e devolve { id, email, token, cabecalho }.
async function criarOperadorComSessao(rotulo = 'op') {
  const email = `${rotulo}-${crypto.randomBytes(5).toString('hex')}@teste.invalid`;
  const { rows } = await db.query(
    `INSERT INTO plataforma_operadores (nome, email, senha, senha_temporaria, totp_segredo, totp_ativo)
     VALUES ('Operador de Teste', $1, 'hash-nao-usado-nos-testes', false, 'segredo-nao-usado', true) RETURNING *`,
    [email]
  );
  const operador = rows[0];
  const { token } = painelAuthService.renovar(operador);
  return { id: operador.id, email, token, cabecalho: { Authorization: `Bearer ${token}` } };
}

// Remove operador e trilha (a trilha é só-inserção; a limpeza de teste usa o bypass documentado).
async function removerOperador(operador) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL vertumno.limpeza_teste = 'on'`);
    await c.query('DELETE FROM plataforma_eventos WHERE operador_id = $1', [operador.id]);
    await c.query('DELETE FROM plataforma_operadores WHERE id = $1', [operador.id]);
    await c.query('COMMIT');
  } catch (erro) {
    await c.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    c.release();
  }
}

module.exports = { criarOperadorComSessao, removerOperador };
