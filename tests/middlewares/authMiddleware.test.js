const jwt = require('jsonwebtoken');
const authMiddleware = require('../../src/middlewares/authMiddleware');
const sessaoRepository = require('../../src/repositories/sessaoRepository');

function mockReq(headers = {}) {
  return { headers };
}

function token(payload = {}, options = { expiresIn: '1h' }) {
  return jwt.sign({ id: 42, role: 'vendedor', empresa_id: 7, tv: 0, ...payload }, process.env.JWT_SECRET, options);
}

async function executar(req) {
  const next = jest.fn();
  await authMiddleware(req, {}, next);
  return next;
}

describe('authMiddleware', () => {
  test('rejects a request without an Authorization header', async () => {
    const next = await executar(mockReq());

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Token não informado');
  });

  test('rejects a header that is not "Bearer <token>"', async () => {
    const next = await executar(mockReq({ authorization: 'Basic abc' }));

    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  test('rejects an invalid/garbage token', async () => {
    const next = await executar(mockReq({ authorization: 'Bearer not-a-real-token' }));

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Token inválido ou expirado');
  });

  test('rejects an expired token', async () => {
    const next = await executar(mockReq({ authorization: `Bearer ${token({}, { expiresIn: -10 })}` }));

    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  test('accepts a valid token and populates req.usuario (empresa_id vem do token verificado)', async () => {
    const req = mockReq({ authorization: `Bearer ${token()}` });
    const next = await executar(req);

    expect(next).toHaveBeenCalledWith();
    expect(req.usuario).toEqual({ id: 42, role: 'vendedor', empresa_id: 7 });
    expect(sessaoRepository.buscarEstado).toHaveBeenCalledWith(42, 7);
  });

  describe('segurança do JWT', () => {
    test('rejeita token com alg "none" (sem assinatura)', async () => {
      const semAssinatura = [
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify({ id: 1, role: 'admin', empresa_id: 1, tv: 0 })).toString('base64url'),
        ''
      ].join('.');

      const next = await executar(mockReq({ authorization: `Bearer ${semAssinatura}` }));

      expect(next.mock.calls[0][0].statusCode).toBe(401);
      expect(sessaoRepository.buscarEstado).not.toHaveBeenCalled();
    });

    test('rejeita token assinado com outro algoritmo (HS512) mesmo com o segredo certo', async () => {
      const hs512 = jwt.sign({ id: 1, role: 'admin', empresa_id: 1, tv: 0 }, process.env.JWT_SECRET, { algorithm: 'HS512' });

      const next = await executar(mockReq({ authorization: `Bearer ${hs512}` }));

      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    test('rejeita token assinado com outro segredo', async () => {
      const forjado = jwt.sign({ id: 1, role: 'admin', empresa_id: 1, tv: 0 }, 'outro-segredo-qualquer');

      const next = await executar(mockReq({ authorization: `Bearer ${forjado}` }));

      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });
  });

  describe('revogação de acesso', () => {
    const autorizado = () => mockReq({ authorization: `Bearer ${token({ tv: 2 })}` });

    test('token com token_version antiga (revogado) deixa de funcionar', async () => {
      sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 3, empresa_status: 'ativa' });

      const req = autorizado();
      const next = await executar(req);

      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Token inválido ou expirado');
      expect(req.usuario).toBeUndefined();
    });

    test('token com a token_version atual continua válido', async () => {
      sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 2, empresa_status: 'ativa' });

      const next = await executar(autorizado());

      expect(next).toHaveBeenCalledWith();
    });

    test('token antigo, sem a claim tv, vale como versão 0', async () => {
      const legado = jwt.sign({ id: 42, role: 'vendedor', empresa_id: 7 }, process.env.JWT_SECRET, { expiresIn: '1h' });
      sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 0, empresa_status: 'ativa' });

      const next = await executar(mockReq({ authorization: `Bearer ${legado}` }));
      expect(next).toHaveBeenCalledWith();

      sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 1, empresa_status: 'ativa' });
      const revogado = await executar(mockReq({ authorization: `Bearer ${legado}` }));
      expect(revogado.mock.calls[0][0].statusCode).toBe(401);
    });

    test('usuário inativo perde acesso mesmo com token ainda dentro do prazo', async () => {
      sessaoRepository.buscarEstado.mockResolvedValue({ ativo: false, token_version: 2, empresa_status: 'ativa' });

      const next = await executar(autorizado());

      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    test('empresa inativa derruba o acesso de todos os usuários dela', async () => {
      sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 2, empresa_status: 'inativa' });

      const next = await executar(autorizado());

      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    test('usuário que não existe mais (ou de outra empresa que não bate com o token) é negado', async () => {
      sessaoRepository.buscarEstado.mockResolvedValue(null);

      const next = await executar(autorizado());

      expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    test('falha ao consultar a sessão nega o acesso (fail-closed) e não autentica', async () => {
      sessaoRepository.buscarEstado.mockRejectedValue(new Error('connection refused'));

      const req = autorizado();
      const next = await executar(req);

      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect(req.usuario).toBeUndefined();
    });
  });
});
