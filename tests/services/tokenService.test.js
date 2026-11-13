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

describe('política de sessão (teto de 8 h e renovação)', () => {
  const agora = () => Math.floor(Date.now() / 1000);
  const usuario = { id: 1, papel: 'admin', empresa_id: 9, token_version: 2 };
  const antes = process.env.SESSAO_RENOVAVEL;

  afterEach(() => {
    if (antes === undefined) delete process.env.SESSAO_RENOVAVEL;
    else process.env.SESSAO_RENOVAVEL = antes;
  });

  test('o token leva o início da sessão (sa), assinado', () => {
    const { payload } = jwt.decode(tokenService.emitirToken(usuario), { complete: true });

    expect(Math.abs(payload.sa - agora())).toBeLessThanOrEqual(2);
  });

  test('sem SESSAO_RENOVAVEL: token de 8 h, como sempre', () => {
    delete process.env.SESSAO_RENOVAVEL;
    const { payload } = jwt.decode(tokenService.emitirToken(usuario), { complete: true });

    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
  });

  test('com SESSAO_RENOVAVEL=true: token curto de 1 h', () => {
    process.env.SESSAO_RENOVAVEL = 'true';
    const { payload } = jwt.decode(tokenService.emitirToken(usuario), { complete: true });

    expect(payload.exp - payload.iat).toBe(60 * 60);
  });

  test('a renovação mantém o início (sa) e o teto de 8 h: perto do fim o token vive só o que resta', () => {
    process.env.SESSAO_RENOVAVEL = 'true';
    const sa = agora() - (7 * 60 * 60 + 40 * 60); // sessão com 7 h 40 min
    const { payload } = jwt.decode(tokenService.emitirToken(usuario, { sa }), { complete: true });

    expect(payload.sa).toBe(sa);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(20 * 60 + 2);
    expect(payload.exp - payload.iat).toBeGreaterThanOrEqual(20 * 60 - 2);
    expect(payload.exp).toBeLessThanOrEqual(sa + 8 * 60 * 60 + 1);
  });
});
