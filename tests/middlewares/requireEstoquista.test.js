const requireEstoquista = require('../../src/middlewares/requireEstoquista');

describe('requireEstoquista', () => {
  test('rejects when req.usuario is missing', () => {
    const next = jest.fn();
    requireEstoquista({}, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });

  test('rejects a vendedor', () => {
    const next = jest.fn();
    requireEstoquista({ usuario: { id: 1, role: 'vendedor' } }, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });

  test('allows an estoquista through', () => {
    const next = jest.fn();
    requireEstoquista({ usuario: { id: 1, role: 'estoquista' } }, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  test('allows an admin through', () => {
    const next = jest.fn();
    requireEstoquista({ usuario: { id: 1, role: 'admin' } }, {}, next);

    expect(next).toHaveBeenCalledWith();
  });
});
