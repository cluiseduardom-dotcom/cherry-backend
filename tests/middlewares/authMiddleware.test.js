const jwt = require('jsonwebtoken');
const authMiddleware = require('../../src/middlewares/authMiddleware');

function mockReq(headers = {}) {
  return { headers };
}

describe('authMiddleware', () => {
  test('rejects a request without an Authorization header', () => {
    const next = jest.fn();
    authMiddleware(mockReq(), {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Token não informado');
  });

  test('rejects a header that is not "Bearer <token>"', () => {
    const next = jest.fn();
    authMiddleware(mockReq({ authorization: 'Basic abc' }), {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  test('rejects an invalid/garbage token', () => {
    const next = jest.fn();
    authMiddleware(mockReq({ authorization: 'Bearer not-a-real-token' }), {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Token inválido ou expirado');
  });

  test('rejects an expired token', () => {
    const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const next = jest.fn();
    authMiddleware(mockReq({ authorization: `Bearer ${token}` }), {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  test('accepts a valid token and populates req.usuario', () => {
    const token = jwt.sign({ id: 42, role: 'vendedor' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const next = jest.fn();

    authMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.usuario).toEqual({ id: 42, role: 'vendedor' });
  });
});
