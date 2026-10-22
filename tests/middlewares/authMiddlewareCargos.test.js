const jwt = require('jsonwebtoken');
const authMiddleware = require('../../src/middlewares/authMiddleware');
const sessaoRepository = require('../../src/repositories/sessaoRepository');

// O cargo e as capacidades vêm do BANCO a cada requisição; o `role` do JWT só vale como
// último recurso. Estes testes cobrem o que o authMiddleware.test.js original não cobria.

const token = (payload = {}) => jwt.sign({ id: 42, role: 'vendedor', empresa_id: 7, tv: 0, ...payload }, process.env.JWT_SECRET, { expiresIn: '1h' });
const estado = (extra = {}) => ({ ativo: true, token_version: 0, empresa_status: 'ativa', ...extra });

async function executar(tokenAssinado) {
    const req = { headers: { authorization: `Bearer ${tokenAssinado}` } };
    const next = jest.fn();

    await authMiddleware(req, {}, next);

    return { req, next };
}

describe('authMiddleware — cargo e capacidades vindos do banco', () => {
    test('o cargo do banco prevalece sobre o do JWT (rebaixar alguém vale na hora)', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'vendedor' }));

        const { req, next } = await executar(token({ role: 'admin' }));

        expect(next).toHaveBeenCalledWith();
        expect(req.usuario).toMatchObject({ role: 'vendedor', cargo: 'vendedor' });
    });

    test('promover alguém vale na hora, sem novo login', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'admin' }));

        const { req } = await executar(token({ role: 'vendedor' }));

        expect(req.usuario).toMatchObject({ role: 'admin', cargo: 'admin', nivel: 90 });
    });

    test('cargo novo ligado pelo comércio: perfil de vendedor, nível e capacidades da linha', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({
            papel: 'gerente', cargo_configurado: true, cargo_nivel: 70, cargo_ativo: true, cargo_capacidades: ['ver_custos']
        }));

        const { req, next } = await executar(token());

        expect(next).toHaveBeenCalledWith();
        expect(req.usuario).toEqual({
            id: 42, role: 'vendedor', cargo: 'gerente', nivel: 70, capacidades: ['ver_custos'], empresa_id: 7
        });
    });

    test('capacidade `administrador` no cargo vira perfil admin', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({
            papel: 'analista', cargo_configurado: true, cargo_nivel: 40, cargo_ativo: true, cargo_capacidades: ['administrador']
        }));

        const { req } = await executar(token());

        expect(req.usuario.role).toBe('admin');
    });

    test('cargo novo ainda não ligado no comércio: 403, e a rota não é chamada', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'gerente', cargo_configurado: false }));

        const { req, next } = await executar(token());

        expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, message: 'Cargo desabilitado neste comércio' });
        expect(req.usuario).toBeUndefined();
    });

    test('cargo desligado depois de configurado: 403', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({
            papel: 'supervisor', cargo_configurado: true, cargo_nivel: 50, cargo_ativo: false, cargo_capacidades: []
        }));

        const { next } = await executar(token());

        expect(next.mock.calls[0][0].statusCode).toBe(403);
    });

    test('cargo desconhecido no banco: nega com 401 genérico (fail-closed)', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'presidente' }));

        const { req, next } = await executar(token());

        expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, message: 'Token inválido ou expirado' });
        expect(req.usuario).toBeUndefined();
    });

    test('revogação continua valendo antes de qualquer cargo (token_version)', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado({ papel: 'admin', token_version: 3 }));

        const { next } = await executar(token({ tv: 0 }));

        expect(next.mock.calls[0][0].statusCode).toBe(401);
    });

    test('sem `papel` na consulta, vale o do JWT (compatibilidade)', async () => {
        sessaoRepository.buscarEstado.mockResolvedValue(estado());

        const { req } = await executar(token({ role: 'estoquista' }));

        expect(req.usuario).toMatchObject({ role: 'estoquista', cargo: 'estoquista', nivel: null });
    });
});
