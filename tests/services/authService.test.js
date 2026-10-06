jest.mock('../../src/repositories/usuarioRepository');
jest.mock('bcrypt');
jest.mock('jsonwebtoken');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const usuarioRepository = require('../../src/repositories/usuarioRepository');
const authService = require('../../src/services/authService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authService.login', () => {
  test('throws 401 when the user does not exist', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue(null);

    await expect(authService.login('missing@x.com', 'senha123')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Email ou senha inválidos'
    });
  });

  test('throws 401 when the password does not match', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue({ id: 1, senha: 'hash' });
    bcrypt.compare.mockResolvedValue(false);

    await expect(authService.login('a@x.com', 'wrong')).rejects.toMatchObject({
      statusCode: 401
    });
  });

  test('returns a token and usuario on success', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue({
      id: 1,
      nome: 'Ana',
      email: 'a@x.com',
      senha: 'hash',
      papel: 'admin'
    });
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('signed-token');

    const result = await authService.login('a@x.com', 'senha123');

    expect(jwt.sign).toHaveBeenCalledWith(
      { id: 1, role: 'admin', empresa_id: undefined, tv: 0 },
      process.env.JWT_SECRET,
      { expiresIn: '8h', algorithm: 'HS256' }
    );
    expect(result).toEqual({
      token: 'signed-token',
      usuario: { id: 1, nome: 'Ana', email: 'a@x.com', papel: 'admin', empresa_id: undefined }
    });
  });

  test('embute a token_version atual do usuário no token', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue({
      id: 1, nome: 'Ana', email: 'a@x.com', senha: 'hash', papel: 'admin', empresa_id: 7, token_version: 3, ativo: true, empresa_status: 'ativa'
    });
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('signed-token');

    await authService.login('a@x.com', 'senha123');

    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ empresa_id: 7, tv: 3 }),
      process.env.JWT_SECRET,
      expect.any(Object)
    );
  });

  test('usuário inativo não autentica, mesmo com a senha correta, e a resposta é igual à de senha errada', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue({
      id: 1, senha: 'hash', papel: 'admin', empresa_id: 1, ativo: false, empresa_status: 'ativa'
    });
    bcrypt.compare.mockResolvedValue(true);

    await expect(authService.login('a@x.com', 'senha-correta')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Email ou senha inválidos'
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  test('empresa inativa não autentica, mesmo com a senha correta', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue({
      id: 1, senha: 'hash', papel: 'admin', empresa_id: 1, ativo: true, empresa_status: 'inativa'
    });
    bcrypt.compare.mockResolvedValue(true);

    await expect(authService.login('a@x.com', 'senha-correta')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Email ou senha inválidos'
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  test('e-mail inexistente ainda paga um bcrypt.compare (sem diferença de tempo observável)', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue(null);
    bcrypt.compare.mockResolvedValue(false);

    await expect(authService.login('missing@x.com', 'qualquer')).rejects.toMatchObject({ statusCode: 401 });
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
  });
});

describe('authService.register', () => {
  test('throws 409 when the email is already taken', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue({ id: 1 });

    await expect(
      authService.register('Ana', 'a@x.com', 'senha123', 'vendedor')
    ).rejects.toMatchObject({ statusCode: 409, message: 'Email já cadastrado' });

    expect(usuarioRepository.criar).not.toHaveBeenCalled();
  });

  test('hashes the password and creates the user', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue(null);
    bcrypt.hash.mockResolvedValue('hashed-senha');
    usuarioRepository.criar.mockResolvedValue({
      id: 5,
      nome: 'Ana',
      email: 'a@x.com',
      papel: 'vendedor'
    });

    const result = await authService.register('Ana', 'a@x.com', 'senha123', 'vendedor');

    expect(bcrypt.hash).toHaveBeenCalledWith('senha123', 10);
    expect(usuarioRepository.criar).toHaveBeenCalledWith({
      nome: 'Ana',
      email: 'a@x.com',
      senha: 'hashed-senha',
      papel: 'vendedor'
    });
    expect(result).toEqual({
      usuario: { id: 5, nome: 'Ana', email: 'a@x.com', papel: 'vendedor' }
    });
  });
});
