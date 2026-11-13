const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const sessaoRepository = require('../../src/repositories/sessaoRepository');

const agora = () => Math.floor(Date.now() / 1000);
const token = (extra = {}, opcoes = { expiresIn: '1h' }) => jwt.sign({ id: 5, role: 'vendedor', empresa_id: 3, tv: 0, ...extra }, process.env.JWT_SECRET, opcoes);

describe('POST /auth/renovar', () => {
  test('sem token: 401', async () => {
    expect((await request(app).post('/auth/renovar')).status).toBe(401);
  });

  test('sessão dentro do teto: devolve token novo com o MESMO início, sem cache', async () => {
    const sa = agora() - 600;
    const res = await request(app).post('/auth/renovar').set('Authorization', `Bearer ${token({ sa })}`);
    const novo = jwt.decode(res.body.data.token);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(novo).toMatchObject({ id: 5, empresa_id: 3, tv: 0, sa });
  });

  test('o novo token reflete o estado do banco (cargo e versão), não o do token antigo', async () => {
    sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 4, empresa_status: 'ativa', papel: 'admin', funcionalidades: [] });
    const res = await request(app).post('/auth/renovar').set('Authorization', `Bearer ${token({ tv: 4, sa: agora() })}`);

    expect(jwt.decode(res.body.data.token)).toMatchObject({ role: 'admin', tv: 4 });
  });

  test('passou do teto de 8 h desde o login: 401, é preciso entrar de novo', async () => {
    const sa = agora() - 9 * 60 * 60;
    const res = await request(app).post('/auth/renovar').set('Authorization', `Bearer ${token({ sa }, { expiresIn: '10h' })}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Sessão expirada/);
  });

  test('token antigo, sem `sa`: usa a emissão (iat) como início', async () => {
    const velho = jwt.sign({ id: 5, role: 'vendedor', empresa_id: 3, tv: 0, iat: agora() - 9 * 60 * 60 }, process.env.JWT_SECRET, { expiresIn: '12h' });

    expect((await request(app).post('/auth/renovar').set('Authorization', `Bearer ${velho}`)).status).toBe(401);
  });

  test('usuário revogado (token_version mudou) não renova', async () => {
    sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 9, empresa_status: 'ativa', funcionalidades: [] });

    expect((await request(app).post('/auth/renovar').set('Authorization', `Bearer ${token({ sa: agora() })}`)).status).toBe(401);
  });

  test('corpo e query são ignorados: id e empresa vêm só do token', async () => {
    const res = await request(app).post('/auth/renovar?empresa_id=99').set('Authorization', `Bearer ${token({ sa: agora() })}`).send({ empresa_id: 99, id: 1, role: 'admin' });

    expect(jwt.decode(res.body.data.token)).toMatchObject({ id: 5, empresa_id: 3, role: 'vendedor' });
  });
});
