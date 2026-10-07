jest.mock('../../src/services/clientesService');
jest.mock('../../src/services/vendasService');
jest.mock('../../src/services/produtosService');
jest.mock('../../src/services/pagamentosService');

const request = require('supertest');
const clientesService = require('../../src/services/clientesService');
const vendasService = require('../../src/services/vendasService');
const produtosService = require('../../src/services/produtosService');
const sessaoRepository = require('../../src/repositories/sessaoRepository');
const app = require('../../src/app');
const { makeToken } = require('../helpers/token');

const admin = makeToken({ id: 1, role: 'admin', empresa_id: 1 });
const vendedor = makeToken({ id: 2, role: 'vendedor', empresa_id: 1 });
const estoquista = makeToken({ id: 3, role: 'estoquista', empresa_id: 1 });
const auth = (token) => ({ Authorization: `Bearer ${token}` });

let consoleError;

beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => consoleError.mockRestore());

describe('PII de clientes respeita RBAC na API (#87 item 8)', () => {
  const rotas = [
    ['post', '/clientes', { nome: 'X' }],
    ['get', '/clientes', null],
    ['patch', '/clientes/1', { nome: 'X' }],
    ['get', '/clientes/ranking', null],
    ['get', '/clientes/1/total-gasto', null],
    ['get', '/clientes/1/historico', null],
    ['patch', '/clientes/1/anonimizar', null]
  ];

  test.each(rotas)('estoquista recebe 403 em %s %s e o serviço não é chamado', async (metodo, caminho, corpo) => {
    const req = request(app)[metodo](caminho).set(auth(estoquista));
    const res = await (corpo ? req.send(corpo) : req);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    Object.values(clientesService).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  test.each(rotas)('sem token recebe 401 em %s %s', async (metodo, caminho, corpo) => {
    const req = request(app)[metodo](caminho);
    const res = await (corpo ? req.send(corpo) : req);

    expect(res.status).toBe(401);
  });

  test('vendedor e admin continuam acessando a listagem', async () => {
    clientesService.listar.mockResolvedValue([]);

    expect((await request(app).get('/clientes').set(auth(vendedor))).status).toBe(200);
    expect((await request(app).get('/clientes').set(auth(admin))).status).toBe(200);
  });

  test('vendedor continua sem anonimizar (admin only)', async () => {
    expect((await request(app).patch('/clientes/1/anonimizar').set(auth(vendedor))).status).toBe(403);
  });
});

describe('revogação de acesso ponta a ponta (HTTP)', () => {
  test('usuário desativado depois de logar recebe 401 e a rota não executa', async () => {
    sessaoRepository.buscarEstado.mockResolvedValue({ ativo: false, token_version: 0, empresa_status: 'ativa' });

    const res = await request(app).get('/produtos').set(auth(admin));

    expect(res.status).toBe(401);
    expect(produtosService.listar).not.toHaveBeenCalled();
  });

  test('token_version avançada (revogação em massa) derruba o token antigo', async () => {
    sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 1, empresa_status: 'ativa' });

    expect((await request(app).get('/produtos').set(auth(admin))).status).toBe(401);
  });

  test('empresa inativa: nenhum usuário dela acessa', async () => {
    sessaoRepository.buscarEstado.mockResolvedValue({ ativo: true, token_version: 0, empresa_status: 'inativa' });

    expect((await request(app).get('/vendas/resumo').set(auth(vendedor))).status).toBe(401);
  });

  test('a consulta de sessão usa o empresa_id do token', async () => {
    produtosService.listar.mockResolvedValue({ items: [], total: 0 });

    await request(app).get('/produtos').set(auth(makeToken({ id: 9, role: 'admin', empresa_id: 33 })));

    expect(sessaoRepository.buscarEstado).toHaveBeenCalledWith(9, 33);
  });
});

describe('respostas 5xx genéricas (#87 item 6)', () => {
  test('erro do banco com SQL/coluna no texto não chega ao cliente', async () => {
    const erroPg = Object.assign(new Error('column "preco_custo" of relation "produtos" does not exist'), { code: '42703' });
    produtosService.listar.mockRejectedValue(erroPg);

    const res = await request(app).get('/produtos').set(auth(admin));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Erro interno do servidor' });
    expect(consoleError).toHaveBeenCalledWith(erroPg);
  });

  test('erro de conexão com a connection string no texto não vaza', async () => {
    produtosService.listar.mockRejectedValue(new Error('connect ECONNREFUSED postgresql://u:senha-secreta@10.0.0.5/db'));

    const res = await request(app).get('/produtos').set(auth(admin));

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/senha-secreta|ECONNREFUSED|postgresql/);
  });

  test('JSON malformado responde 400 genérico, sem o texto do parser', async () => {
    const res = await request(app)
      .post('/vendas')
      .set(auth(admin))
      .set('Content-Type', 'application/json')
      .send('{"itens": [');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Requisição inválida' });
  });

  test('erro de validação de negócio (4xx) mantém a mensagem útil', async () => {
    const res = await request(app).post('/vendas').set(auth(admin)).send({ itens: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A venda deve ter ao menos um item');
  });
});

describe('números não finitos e absurdos (#87 itens 1 e 7)', () => {
  test('1e999 no corpo JSON (vira Infinity) é rejeitado na borda com 400', async () => {
    const res = await request(app)
      .post('/pagamentos/1/estornar')
      .set(auth(admin))
      .set('Content-Type', 'application/json')
      .send('{"valor": 1e999, "motivo": "x"}');

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Corpo da requisição contém número inválido');
  });

  test('NaN/Infinity como string em campo validado por Zod é rejeitado', async () => {
    const corpo = { itens: [{ produto_id: 1, quantidade: 1 }], desconto: 'Infinity' };

    const res = await request(app).post('/vendas').set(auth(admin)).send(corpo);

    expect(res.status).toBe(400);
    expect(vendasService.criar).not.toHaveBeenCalled();
  });

  const pagamento = (extra) => ({ forma_pagamento: 'crediario', valor: 100, ...extra });
  const venda = (pagamentos) => ({ cliente_id: 1, itens: [{ produto_id: 1, quantidade: 1 }], pagamentos });

  test.each([
    ['numero_parcelas 1e9 (loop de INSERTs)', pagamento({ numero_parcelas: 1000000000, meses_prazo: 1 })],
    ['numero_parcelas 25 (acima do teto)', pagamento({ numero_parcelas: 25, meses_prazo: 1 })],
    ['meses_prazo 1e9', pagamento({ numero_parcelas: 2, meses_prazo: 1000000000 })],
    ['meses_prazo 25 (acima do teto)', pagamento({ numero_parcelas: 2, meses_prazo: 25 })],
    ['valor 1e15', pagamento({ valor: 1e15 })]
  ])('rejeita %s com 400 sem chamar o serviço', async (_, pag) => {
    const res = await request(app).post('/vendas').set(auth(admin)).send(venda([pag]));

    expect(res.status).toBe(400);
    expect(vendasService.criar).not.toHaveBeenCalled();
  });

  test('o teto de parcelas (24) ainda é aceito', async () => {
    vendasService.criar.mockResolvedValue({ id: 1, itens: [] });

    const res = await request(app).post('/vendas').set(auth(admin)).send(venda([pagamento({ numero_parcelas: 24, meses_prazo: 24 })]));

    expect(res.status).toBe(201);
  });

  test('array de pagamentos acima do limite é rejeitado', async () => {
    const pagamentos = Array.from({ length: 11 }, () => ({ forma_pagamento: 'pix', valor: 1 }));

    const res = await request(app).post('/vendas').set(auth(admin)).send(venda(pagamentos));

    expect(res.status).toBe(400);
  });

  test('array de itens acima do limite é rejeitado sem alocação desproporcional', async () => {
    const itens = Array.from({ length: 201 }, () => ({ produto_id: 1, quantidade: 1 }));

    const res = await request(app).post('/vendas').set(auth(admin)).send({ itens });

    expect(res.status).toBe(400);
    expect(vendasService.criar).not.toHaveBeenCalled();
  });
});

describe('configuração de produção (CORS, trust proxy, rate limit)', () => {
  const envOriginal = { ...process.env };
  let appProd;

  function carregarApp(env) {
    jest.resetModules();
    jest.doMock('../../src/services/authService');
    // Ausência da variável precisa ser real (process.env coage undefined em 'undefined').
    delete process.env.TRUST_PROXY_HOPS;
    Object.assign(process.env, env);
    appProd = require('../../src/app');
    return appProd;
  }

  afterEach(() => {
    process.env = { ...envOriginal };
    jest.resetModules();
  });

  test('origem não permitida responde 403 (não 500) com mensagem genérica', async () => {
    carregarApp({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.exemplo.com', TRUST_PROXY_HOPS: '2' });

    const res = await request(appProd).get('/health').set('Origin', 'https://evil.exemplo.com');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: 'Origem não permitida pelo CORS' });
  });

  describe('TRUST_PROXY_HOPS é obrigatório em production/staging (sem fallback silencioso)', () => {
    test.each(['production', 'staging'])('%s sem TRUST_PROXY_HOPS falha ao carregar o app', (NODE_ENV) => {
      expect(() => carregarApp({ NODE_ENV, CORS_ORIGINS: 'https://app.exemplo.com' }))
        .toThrow(/TRUST_PROXY_HOPS deve ser configurado em/);
    });

    test.each(['production', 'staging'])('%s com TRUST_PROXY_HOPS vazio falha ao carregar o app', (NODE_ENV) => {
      expect(() => carregarApp({ NODE_ENV, CORS_ORIGINS: 'https://app.exemplo.com', TRUST_PROXY_HOPS: '   ' }))
        .toThrow(/TRUST_PROXY_HOPS deve ser configurado em/);
    });

    test.each(['true', 'false', '-1', '1.5', 'abc', '2 proxies', '0x2'])(
      'valor inválido %p é rejeitado (nunca vira `true` nem é aceito pela metade)',
      (TRUST_PROXY_HOPS) => {
        expect(() => carregarApp({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.exemplo.com', TRUST_PROXY_HOPS }))
          .toThrow(/TRUST_PROXY_HOPS inválido/);
      }
    );

    test('valor inválido também é rejeitado fora de production/staging', () => {
      expect(() => carregarApp({ NODE_ENV: 'development', TRUST_PROXY_HOPS: 'true' }))
        .toThrow(/TRUST_PROXY_HOPS inválido/);
    });

    test.each([
      [{ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' }, 2],
      [{ NODE_ENV: 'staging', TRUST_PROXY_HOPS: '2' }, 2],
      [{ NODE_ENV: 'production', TRUST_PROXY_HOPS: '1' }, 1],
      [{ NODE_ENV: 'production', TRUST_PROXY_HOPS: ' 3 ' }, 3],
      [{ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' }, 0]
    ])('valor explícito %j é respeitado como %p', (env, esperado) => {
      carregarApp({ CORS_ORIGINS: 'https://app.exemplo.com', ...env });

      expect(appProd.get('trust proxy')).toBe(esperado);
    });

    test.each(['development', 'test'])('%s sem TRUST_PROXY_HOPS usa 0 (sem proxy)', (NODE_ENV) => {
      carregarApp({ NODE_ENV });

      expect(appProd.get('trust proxy')).toBe(0);
    });
  });

  test('em produção, falhas de um IP/e-mail não bloqueiam outro usuário atrás do mesmo proxy', async () => {
    carregarApp({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.exemplo.com', TRUST_PROXY_HOPS: '1' });
    const authService = require('../../src/services/authService');
    const AppError = require('../../src/errors/AppError');
    authService.login.mockRejectedValue(new AppError('Email ou senha inválidos', 401));

    const tentar = (email, ip) => request(appProd).post('/auth/login').set('X-Forwarded-For', ip).send({ email, senha: 'x' });

    for (let i = 0; i < 5; i++) expect((await tentar('vitima@x.com', '203.0.113.10')).status).toBe(401);
    expect((await tentar('vitima@x.com', '203.0.113.10')).status).toBe(429);

    // outro e-mail, mesmo IP: segue livre
    expect((await tentar('colega@x.com', '203.0.113.10')).status).toBe(401);
    // mesmo e-mail, outro IP (outro cliente atrás do mesmo proxy): segue livre
    expect((await tentar('vitima@x.com', '198.51.100.20')).status).toBe(401);
  });
});
