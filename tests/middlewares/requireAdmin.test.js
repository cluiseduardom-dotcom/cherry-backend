const requireAdmin = require('../../src/middlewares/requireAdmin');

describe('requireAdmin', () => {
  test('rejects when req.usuario is missing', () => {
    const next = jest.fn();
    requireAdmin({}, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Acesso restrito a administradores');
  });

  test('rejects a non-admin role', () => {
    const next = jest.fn();
    requireAdmin({ usuario: { id: 1, role: 'vendedor' } }, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });

  test('allows an admin role through', () => {
    const next = jest.fn();
    requireAdmin({ usuario: { id: 1, role: 'admin' } }, {}, next);

    expect(next).toHaveBeenCalledWith();
  });
});
