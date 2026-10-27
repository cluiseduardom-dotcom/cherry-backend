const requirePlataformaAdmin = require('../../src/middlewares/requirePlataformaAdmin');

describe('requirePlataformaAdmin', () => {
  const chamar = (usuario) => {
    const next = jest.fn();
    requirePlataformaAdmin({ usuario }, {}, next);
    return next.mock.calls[0][0];
  };

  test('recusa quando não há usuário', () => {
    const next = jest.fn();
    requirePlataformaAdmin({}, {}, next);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  test('recusa admin de empresa sem a marca', () => {
    expect(chamar({ id: 1, role: 'admin' }).statusCode).toBe(403);
    expect(chamar({ id: 1, role: 'admin', plataforma_admin: false }).statusCode).toBe(403);
  });

  test('recusa valores que não são exatamente true', () => {
    expect(chamar({ id: 1, role: 'admin', plataforma_admin: 'true' }).statusCode).toBe(403);
    expect(chamar({ id: 1, role: 'admin', plataforma_admin: 1 }).statusCode).toBe(403);
  });

  test('recusa a marca em quem não é admin', () => {
    expect(chamar({ id: 1, role: 'vendedor', plataforma_admin: true }).statusCode).toBe(403);
  });

  test('libera admin com a marca', () => {
    expect(chamar({ id: 1, role: 'admin', plataforma_admin: true })).toBeUndefined();
  });
});
