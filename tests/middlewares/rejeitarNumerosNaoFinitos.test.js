const rejeitarNumerosNaoFinitos = require('../../src/middlewares/rejeitarNumerosNaoFinitos');
const { contemNumeroNaoFinito } = rejeitarNumerosNaoFinitos;

function executar(body) {
  const next = jest.fn();
  rejeitarNumerosNaoFinitos({ body }, {}, next);
  return next;
}

describe('rejeitarNumerosNaoFinitos', () => {
  test.each([
    ['Infinity', { valor: Infinity }],
    ['-Infinity', { valor: -Infinity }],
    ['NaN', { valor: NaN }],
    ['aninhado em objeto', { a: { b: { c: Infinity } } }],
    ['dentro de array', { itens: [{ quantidade: 1 }, { quantidade: Infinity }] }]
  ])('rejeita %s com 400', (_, body) => {
    const err = executar(body).mock.calls[0][0];

    expect(err.statusCode).toBe(400);
  });

  test('1e999 vindo de JSON.parse real vira Infinity e é rejeitado', () => {
    const body = JSON.parse('{"valor": 1e999}');

    expect(executar(body).mock.calls[0][0].statusCode).toBe(400);
  });

  test('aceita números finitos, strings, null e corpo ausente', () => {
    expect(executar({ valor: 10.5, nome: 'Infinity', x: null, itens: [1, 2] })).toHaveBeenCalledWith();
    expect(executar(undefined)).toHaveBeenCalledWith();
  });

  test('aninhamento absurdo é rejeitado em vez de percorrido sem limite', () => {
    let profundo = { valor: 1 };
    for (let i = 0; i < 50; i++) profundo = { filho: profundo };

    expect(contemNumeroNaoFinito(profundo)).toBe(true);
  });
});
