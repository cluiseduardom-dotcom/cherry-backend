// Integração de verdade (Postgres): GET /publico/planos sem login. Só os três planos comerciais, sem Cortesia nem
// legados, sem id interno nem dado de empresa; reflete limite, percentual vigente e funcionalidades do plano.
const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');

afterAll(async () => {
    await db.end();
});

test('responde sem login com os três planos comerciais, nas duas linhas de nome', async () => {
    const res = await request(app).get('/publico/planos');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/public/);

    const { planos } = res.body.data;
    expect(planos.map((p) => p.codigo)).toEqual(['basico', 'padrao', 'pro']);
    expect(planos.map((p) => [p.nome, p.nome_joias])).toEqual([
        ['Semente', 'Pérola'], ['Cultivo', 'Esmeralda'], ['Pomar', 'Safira']
    ]);
    expect(planos.map((p) => p.limite_usuarios)).toEqual([5, 7, 15]);
    expect(planos.map((p) => Number(p.percentual_pix))).toEqual([0.5, 0.4, 0.3]);
});

test('funcionalidades por plano: Básico nenhuma; Padrão e Pro os quatro recursos', async () => {
    const { planos } = (await request(app).get('/publico/planos')).body.data;
    const por = Object.fromEntries(planos.map((p) => [p.codigo, p.funcionalidades]));
    expect(por.basico).toEqual([]);
    expect(por.padrao).toEqual(['analise_financeira', 'bancos', 'comissoes', 'maletas']);
    expect(por.pro).toEqual(por.padrao);
});

test('catálogo traz recursos vendáveis e módulos em breve (vendavel falso)', async () => {
    const { funcionalidades } = (await request(app).get('/publico/planos')).body.data;
    expect(funcionalidades.find((f) => f.codigo === 'comissoes')).toMatchObject({ tipo: 'recurso', vendavel: true });
    expect(funcionalidades.find((f) => f.codigo === 'fiscal')).toMatchObject({ tipo: 'modulo', vendavel: false });
});

test('não vaza plano interno, id nem dado de empresa', async () => {
    const res = await request(app).get('/publico/planos');
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/sem_mensalidade|com_mensalidade|cortesia/);
    for (const p of res.body.data.planos) {
        expect(Object.keys(p).sort()).toEqual(['codigo', 'funcionalidades', 'limite_usuarios', 'nome', 'nome_joias', 'percentual_pix', 'tem_mensalidade']);
    }
});

test('plano novo não aparece sem decisão explícita (exibir_no_site padrão falso)', async () => {
    const codigo = `teste_pub_${Date.now().toString(36)}`;
    await db.query(`INSERT INTO planos_comerciais (codigo, nome, tem_mensalidade) VALUES ($1, 'Teste publico', true)`, [codigo]);
    try {
        const { planos } = (await request(app).get('/publico/planos')).body.data;
        expect(planos.map((p) => p.codigo)).not.toContain(codigo);
    } finally {
        await db.query('DELETE FROM planos_comerciais WHERE codigo = $1', [codigo]);
    }
});
