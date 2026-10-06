const { validarAmbienteDoSeed, obterSenhaDoSeed } = require('../../src/database/seed');

describe('seed — sem credencial conhecida (#87 itens 2 e 3)', () => {
  test.each(['production', 'staging'])('recusa rodar em NODE_ENV=%s', (NODE_ENV) => {
    expect(() => validarAmbienteDoSeed({ NODE_ENV })).toThrow(/não pode rodar/);
  });

  test.each(['development', 'test', undefined])('permite NODE_ENV=%p', (NODE_ENV) => {
    expect(() => validarAmbienteDoSeed({ NODE_ENV })).not.toThrow();
  });

  test.each([undefined, '', 'curta', 'senha123', '12345678901'])('exige SEED_PASSWORD forte; recusa %p', (SEED_PASSWORD) => {
    expect(() => obterSenhaDoSeed({ SEED_PASSWORD })).toThrow(/SEED_PASSWORD/);
  });

  test('usa exatamente a senha informada no ambiente', () => {
    expect(obterSenhaDoSeed({ SEED_PASSWORD: 'uma-senha-bem-longa-1' })).toBe('uma-senha-bem-longa-1');
  });

  test('o código-fonte do seed não contém a senha histórica publicada', () => {
    const fonte = require('node:fs').readFileSync(require.resolve('../../src/database/seed'), 'utf8');

    expect(fonte).not.toContain('senha123');
  });
});
