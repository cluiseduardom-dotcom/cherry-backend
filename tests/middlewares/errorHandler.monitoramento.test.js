jest.mock('../../src/config/monitoramento', () => ({ registrarErro: jest.fn() }));

const { registrarErro } = require('../../src/config/monitoramento');
const errorHandler = require('../../src/middlewares/errorHandler');

const res = () => {
    const r = { status: jest.fn(() => r), json: jest.fn(() => r) };
    return r;
};
const req = { method: 'POST', baseUrl: '/vendas', route: { path: '/:id' } };

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    registrarErro.mockClear();
});
afterEach(() => jest.restoreAllMocks());

test('erro inesperado (500) é reportado com a rota em template, sem ids', () => {
    errorHandler(new Error('falhou'), req, res(), () => {});

    expect(registrarErro).toHaveBeenCalledTimes(1);
    expect(registrarErro.mock.calls[0][1]).toEqual({ rota: '/vendas/:id', metodo: 'POST' });
});

test('erro de entrada do usuário (4xx) e AppError operacional não são reportados', () => {
    const operacional = Object.assign(new Error('Cliente não encontrado'), { isOperational: true, statusCode: 404 });
    errorHandler(operacional, req, res(), () => {});
    errorHandler(Object.assign(new Error('x'), { code: '22P02' }), req, res(), () => {});
    errorHandler(Object.assign(new Error('x'), { status: 400 }), req, res(), () => {});

    expect(registrarErro).not.toHaveBeenCalled();
});

test('a resposta ao cliente continua genérica (nunca o erro)', () => {
    const r = res();
    errorHandler(new Error('segredo interno'), req, r, () => {});

    expect(r.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(r.json.mock.calls)).not.toMatch(/segredo interno/);
});
