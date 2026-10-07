const errorHandler = require('../../src/middlewares/errorHandler');
const AppError = require('../../src/errors/AppError');

function executar(err) {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  errorHandler(err, {}, res, jest.fn());

  return res;
}

describe('errorHandler', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => consoleError.mockRestore());

  test('5xx genérico: não vaza mensagem, stack, SQL nem segredo, mas registra o detalhe em log', () => {
    const erro = new Error('connect ECONNREFUSED postgresql://user:segredo@host/db');
    erro.stack = 'Error: ...\n    at /app/src/repositories/x.js:10:5';

    const res = executar(erro);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Erro interno do servidor' });
    expect(JSON.stringify(res.body)).not.toMatch(/segredo|ECONNREFUSED|repositories|postgresql/);
    expect(consoleError).toHaveBeenCalledWith(erro);
  });

  test('erro do pg de coluna inexistente (42703) não expõe o nome da coluna/tabela', () => {
    const erro = Object.assign(new Error('column "subtotal" of relation "vendas" does not exist'), { code: '42703' });

    const res = executar(erro);

    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe('Erro interno do servidor');
  });

  test('AppError com status 5xx também sai genérico', () => {
    const res = executar(new AppError('detalhe interno sensível', 503));

    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe('Erro interno do servidor');
  });

  test('AppError 4xx mantém a mensagem pensada para o cliente', () => {
    const res = executar(new AppError('Estoque insuficiente', 409));

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ success: false, message: 'Estoque insuficiente' });
  });

  test('numeric overflow do pg (22003) vira 400 com texto genérico, nunca o texto do banco', () => {
    const erro = Object.assign(new Error('numeric field overflow: precision 15, scale 2'), { code: '22003' });

    const res = executar(erro);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Valor numérico fora do intervalo permitido');
    expect(JSON.stringify(res.body)).not.toMatch(/precision/);
  });

  test('valor mal formatado do pg (22P02) vira 400 genérico', () => {
    const erro = Object.assign(new Error('invalid input syntax for type integer: "abc"'), { code: '22P02' });

    const res = executar(erro);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Valor em formato inválido');
  });

  test('erro 4xx que não é AppError (ex.: body-parser) usa texto genérico, não a mensagem do parser', () => {
    const erro = Object.assign(new SyntaxError('Unexpected token } in JSON at position 17'), { statusCode: 400, status: 400 });

    const res = executar(erro);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Requisição inválida' });
  });

  test('status inválido/ausente cai em 500 genérico', () => {
    const res = executar(Object.assign(new Error('x'), { statusCode: 'abc' }));

    expect(res.statusCode).toBe(500);
  });
});
