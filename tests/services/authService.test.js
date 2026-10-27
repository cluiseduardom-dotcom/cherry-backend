jest.mock('../../src/repositories/usuarioRepository');
jest.mock('../../src/services/cargosService');
jest.mock('bcrypt');
jest.mock('jsonwebtoken');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const usuarioRepository = require('../../src/repositories/usuarioRepository');
const cargosService = require('../../src/services/cargosService');
const authService = require('../../src/services/authService');

beforeEach(() => {
  jest.clearAllMocks();
  cargosService.garantirCargoAtivo.mockResolvedValue();
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
      usuario: {
        id: 1, nome: 'Ana', email: 'a@x.com', papel: 'admin', empresa_id: undefined, senha_temporaria: false,
        empresa: { id: undefined, tema: 'vertumno' }
      }
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

describe('authService.login — identidade visual da empresa', () => {
  const usuarioBase = { id: 1, nome: 'Ana', email: 'a@x.com', senha: 'hash', papel: 'admin', empresa_id: 7, token_version: 0, ativo: true, empresa_status: 'ativa' };

  beforeEach(() => {
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('signed-token');
  });

  test('devolve o tema da empresa do próprio usuário', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue({ ...usuarioBase, empresa_tema: 'cherry' });

    const { usuario } = await authService.login('a@x.com', 'senha123');

    expect(usuario.empresa).toEqual({ id: 7, tema: 'cherry' });
  });

  test.each([undefined, null, '', 'desconhecido', 'CHERRY', '__proto__', 42])(
    'tema %p cai em vertumno e o login não quebra', async (tema) => {
      usuarioRepository.buscarPorEmail.mockResolvedValue({ ...usuarioBase, empresa_tema: tema });

      const { token, usuario } = await authService.login('a@x.com', 'senha123');

      expect(token).toBe('signed-token');
      expect(usuario.empresa).toEqual({ id: 7, tema: 'vertumno' });
    }
  );

  test('o JWT não carrega o tema: payload inalterado', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValue({ ...usuarioBase, empresa_tema: 'cherry' });

    await authService.login('a@x.com', 'senha123');

    expect(jwt.sign).toHaveBeenCalledWith(
      { id: 1, role: 'admin', empresa_id: 7, tv: 0 },
      process.env.JWT_SECRET,
      { expiresIn: '8h', algorithm: 'HS256' }
    );
  });

  test('empresa ou usuário inativo não recebe tema: 401 sem token nem dados', async () => {
    for (const extra of [{ empresa_status: 'inativa' }, { ativo: false }]) {
      usuarioRepository.buscarPorEmail.mockResolvedValue({ ...usuarioBase, empresa_tema: 'cherry', ...extra });

      await expect(authService.login('a@x.com', 'senha123')).rejects.toMatchObject({
        statusCode: 401, message: 'Email ou senha inválidos'
      });
    }
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  test('empresas diferentes recebem cada uma o seu tema', async () => {
    usuarioRepository.buscarPorEmail.mockResolvedValueOnce({ ...usuarioBase, empresa_id: 1, empresa_tema: 'cherry' });
    usuarioRepository.buscarPorEmail.mockResolvedValueOnce({ ...usuarioBase, empresa_id: 2, empresa_tema: 'vertumno' });

    const a = await authService.login('a@x.com', 'senha123');
    const b = await authService.login('b@x.com', 'senha123');

    expect(a.usuario.empresa).toEqual({ id: 1, tema: 'cherry' });
    expect(b.usuario.empresa).toEqual({ id: 2, tema: 'vertumno' });
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

  test('recusa cargo não habilitado no comércio, sem consultar nem criar usuário', async () => {
    cargosService.garantirCargoAtivo.mockRejectedValue(Object.assign(new Error('Cargo não habilitado neste comércio'), { statusCode: 409 }));

    await expect(
      authService.register('Ana', 'a@x.com', 'senha123', 'gerente', 7)
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(cargosService.garantirCargoAtivo).toHaveBeenCalledWith(7, 'gerente');
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
