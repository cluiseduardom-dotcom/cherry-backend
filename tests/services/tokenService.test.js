const jwt = require('jsonwebtoken');
const tokenService = require('../../src/services/tokenService');

describe('tokenService', () => {
  test('emite token HS256 com id, role, empresa_id e token_version (tv)', () => {
    const token = tokenService.emitirToken({ id: 1, papel: 'admin', empresa_id: 9, token_version: 4 });
    const { header, payload } = jwt.decode(token, { complete: true });

    expect(header.alg).toBe('HS256');
    expect(payload).toMatchObject({ id: 1, role: 'admin', empresa_id: 9, tv: 4 });
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
  });

  test('usuário sem token_version emite tv 0', () => {
    const { payload } = jwt.decode(tokenService.emitirToken({ id: 1, papel: 'admin', empresa_id: 1 }), { complete: true });

    expect(payload.tv).toBe(0);
  });

  test('verificarToken só aceita HS256', () => {
    const hs384 = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { algorithm: 'HS384' });

    expect(() => tokenService.verificarToken(hs384)).toThrow();
    expect(tokenService.verificarToken(tokenService.emitirToken({ id: 1, papel: 'admin', empresa_id: 1 })).id).toBe(1);
  });
});
