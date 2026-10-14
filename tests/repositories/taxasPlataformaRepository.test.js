jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const taxasPlataformaRepository = require('../../src/repositories/taxasPlataformaRepository');

const POLITICA = { id: 1, tipo: 'percentual', percentual: '0.1500' };
const PLANO_SEM = { plano_id: 10, codigo: 'sem_mensalidade', ativo: true };
const EMPRESA_PLANO_COM = { empresa_plano_id: 55, plano_id: 11, codigo: 'com_mensalidade', ativo: true };

// Simula as consultas da resolução + o INSERT. `plano` = linha de empresa_planos
// vigente (null = empresa sem plano -> cai no padrão).
function fakeClient({ politica = POLITICA, condicao = null, plano = null, padrao = PLANO_SEM } = {}) {
    const client = { query: jest.fn() };

    client.query.mockImplementation((sql) => {
        if (sql.includes('FROM condicoes_comerciais_empresa')) {
            return Promise.resolve({ rows: condicao ? [condicao] : [] });
        }
        if (sql.includes('FROM empresa_planos')) {
            return Promise.resolve({ rows: plano ? [plano] : [] });
        }
        if (sql.includes('FROM planos_comerciais')) {
            return Promise.resolve({ rows: padrao ? [padrao] : [] });
        }
        if (sql.includes('FROM politicas_taxa_plataforma')) {
            return Promise.resolve({ rows: politica ? [politica] : [] });
        }
        if (sql.includes('INSERT INTO taxas_venda')) {
            return Promise.resolve({ rows: [{ id: 77 }] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
    });

    return client;
}

function insertDe(client) {
    const chamada = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO taxas_venda'));
    return chamada ? chamada[1] : null;
}

// [venda_id, empresa_id, politica_id, tipo, percentual, base, valor, plano_id, empresa_plano_id, condicao_id, origem]
const CAMPOS = {
    politica_id: 2, tipo: 3, percentual: 4, base: 5, valor: 6, plano_id: 7, empresa_plano_id: 8, condicao_id: 9, origem: 10
};

beforeEach(() => jest.clearAllMocks());

describe('buscarPoliticaVigente', () => {
    test('só considera política ativa do plano e dentro da vigência, com "hoje" calculado no banco em America/Sao_Paulo', async () => {
        const client = fakeClient();

        const politica = await taxasPlataformaRepository.buscarPoliticaVigente(10, client);

        expect(politica).toEqual(POLITICA);
        const [sql, params] = client.query.mock.calls[0];
        expect(sql).toContain('plano_id = $1');
        expect(sql).toContain('ativo = true');
        expect(sql).toContain('vigencia_inicio <=');
        expect(sql).toContain('vigencia_fim IS NULL OR vigencia_fim >=');
        expect(sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
        expect(sql).not.toContain('empresa_id'); // política é global da plataforma
        expect(params).toEqual([10]);
    });

    test('devolve null quando não há política vigente', async () => {
        expect(await taxasPlataformaRepository.buscarPoliticaVigente(10, fakeClient({ politica: null }))).toBeNull();
    });
});

describe('buscarCondicaoVigente', () => {
    test('filtra pela empresa, só ativa e dentro da vigência', async () => {
        const client = fakeClient({ condicao: { id: 3, tipo: 'percentual', percentual: '0.0000' } });

        const condicao = await taxasPlataformaRepository.buscarCondicaoVigente(9, client);

        expect(condicao).toEqual({ id: 3, tipo: 'percentual', percentual: '0.0000' });
        const [sql, params] = client.query.mock.calls[0];
        expect(sql).toContain('FROM condicoes_comerciais_empresa');
        expect(sql).toContain('empresa_id = $1');
        expect(sql).toContain('ativo = true');
        expect(sql).toContain('vigencia_fim IS NULL OR vigencia_fim >=');
        expect(params).toEqual([9]);
    });
});

describe('buscarPlanoDaEmpresa', () => {
    test('plano vigente da própria empresa: origem plano_padrao', async () => {
        const client = fakeClient({ plano: EMPRESA_PLANO_COM });

        const plano = await taxasPlataformaRepository.buscarPlanoDaEmpresa(9, client);

        expect(plano).toMatchObject({ plano_id: 11, empresa_plano_id: 55, origem: 'plano_padrao' });
        const [sql, params] = client.query.mock.calls[0];
        expect(sql).toContain('ep.empresa_id = $1');
        expect(params).toEqual([9]);
    });

    test('empresa sem plano vigente: plano padrão sem mensalidade, origem padrao_sem_plano, sem empresa_plano', async () => {
        const plano = await taxasPlataformaRepository.buscarPlanoDaEmpresa(9, fakeClient());

        expect(plano).toMatchObject({ plano_id: 10, codigo: 'sem_mensalidade', empresa_plano_id: null, origem: 'padrao_sem_plano' });
    });

    test('plano da empresa inativo: erro 500, não cai no padrão em silêncio', async () => {
        const client = fakeClient({ plano: { ...EMPRESA_PLANO_COM, ativo: false } });

        await expect(taxasPlataformaRepository.buscarPlanoDaEmpresa(9, client)).rejects.toMatchObject({ statusCode: 500 });
    });

    test('plano padrão ausente ou inativo: erro 500', async () => {
        await expect(
            taxasPlataformaRepository.buscarPlanoDaEmpresa(9, fakeClient({ padrao: null }))
        ).rejects.toMatchObject({ statusCode: 500 });
        await expect(
            taxasPlataformaRepository.buscarPlanoDaEmpresa(9, fakeClient({ padrao: { ...PLANO_SEM, ativo: false } }))
        ).rejects.toMatchObject({ statusCode: 500 });
    });
});

describe('apurar', () => {
    test('empresa sem plano, R$ 100,00 a 0,15%: UMA linha com R$ 0,15, congelando política, plano e origem', async () => {
        const client = fakeClient();

        const resultado = await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 100 }, client);

        expect(resultado).toEqual({ id: 77 });
        expect(insertDe(client)).toEqual([5, 9, 1, 'percentual', '0.1500', '100.00', '0.15', 10, null, null, 'padrao_sem_plano']);
        expect(client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO taxas_venda'))).toHaveLength(1);
    });

    test('plano com mensalidade: política de 0,10% do plano (R$ 100,00 -> R$ 0,10) e referência da empresa_planos', async () => {
        const client = fakeClient({
            plano: EMPRESA_PLANO_COM,
            politica: { id: 2, tipo: 'percentual', percentual: '0.1000' }
        });

        await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 100 }, client);

        expect(insertDe(client)).toEqual([5, 9, 2, 'percentual', '0.1000', '100.00', '0.10', 11, 55, null, 'plano_padrao']);
        // a política é buscada para o plano da empresa
        const consultaPolitica = client.query.mock.calls.find(([sql]) => sql.includes('FROM politicas_taxa_plataforma'));
        expect(consultaPolitica[1]).toEqual([11]);
    });

    test('exceção individual prevalece sobre o plano: percentual da condição, política do plano e condicao_id congelados', async () => {
        const client = fakeClient({
            plano: EMPRESA_PLANO_COM,
            politica: { id: 2, tipo: 'percentual', percentual: '0.1000' },
            condicao: { id: 8, tipo: 'percentual', percentual: '0.0500' }
        });

        await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 1000 }, client);

        const insert = insertDe(client);
        expect(insert[CAMPOS.origem]).toBe('excecao_empresa');
        expect(insert[CAMPOS.condicao_id]).toBe(8);
        expect(insert[CAMPOS.percentual]).toBe('0.0500');
        expect(insert[CAMPOS.valor]).toBe('0.50'); // 1000 * 0,05%
        expect(insert[CAMPOS.politica_id]).toBe(2);
        expect(insert[CAMPOS.plano_id]).toBe(11);
    });

    test('exceção com 0%: grava a taxa com valor R$ 0,00 (a venda continua gerando 1 linha)', async () => {
        const client = fakeClient({ condicao: { id: 8, tipo: 'percentual', percentual: '0.0000' } });

        await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 12345.67 }, client);

        const insert = insertDe(client);
        expect(insert[CAMPOS.valor]).toBe('0.00');
        expect(insert[CAMPOS.percentual]).toBe('0.0000');
        expect(insert[CAMPOS.origem]).toBe('excecao_empresa');
    });

    test('R$ 1,00: taxa R$ 0,00 (R$ 0,0015 arredondado), sem mínimo artificial', async () => {
        const client = fakeClient();

        await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 1 }, client);

        expect(insertDe(client).slice(0, 7)).toEqual([5, 9, 1, 'percentual', '0.1500', '1.00', '0.00']);
    });

    test('usa o total FINAL da venda recebido (já com desconto e acréscimo) sem somar nada de novo', async () => {
        const client = fakeClient();

        // subtotal 100 - desconto 10 + juros 5 = 95 (calculado por vendasRepository)
        await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 95 }, client);

        expect(insertDe(client)[CAMPOS.base]).toBe('95.00');
        expect(insertDe(client)[CAMPOS.valor]).toBe('0.14'); // 9500 * 0,0015 = 14,25 -> 14 centavos
    });

    test('sem política vigente do plano: lança erro 500 e não grava nada', async () => {
        const client = fakeClient({ politica: null });

        await expect(
            taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 100 }, client)
        ).rejects.toMatchObject({ statusCode: 500 });

        expect(insertDe(client)).toBeNull();
    });

    test('a exceção não mascara política do plano inválida: continua bloqueando a venda', async () => {
        const client = fakeClient({ politica: null, condicao: { id: 8, tipo: 'percentual', percentual: '0.0000' } });

        await expect(
            taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 100 }, client)
        ).rejects.toMatchObject({ statusCode: 500 });

        expect(insertDe(client)).toBeNull();
    });

    test('percentual inválido na exceção (fora de 0..100): erro 500 e nada é gravado', async () => {
        const client = fakeClient({ condicao: { id: 8, tipo: 'percentual', percentual: '101' } });

        await expect(
            taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 100 }, client)
        ).rejects.toMatchObject({ statusCode: 500 });

        expect(insertDe(client)).toBeNull();
    });

    test('total inválido: lança erro 500 e não grava nada', async () => {
        const client = fakeClient();

        await expect(
            taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: NaN }, client)
        ).rejects.toMatchObject({ statusCode: 500 });

        expect(insertDe(client)).toBeNull();
    });

    test('falha ao persistir propaga o erro (a transação da venda sofre ROLLBACK no chamador)', async () => {
        const client = fakeClient();
        const base = client.query.getMockImplementation();
        client.query.mockImplementation((sql, params) => {
            if (sql.includes('INSERT INTO taxas_venda')) return Promise.reject(new Error('falha de gravação'));
            return base(sql, params);
        });

        await expect(
            taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 100 }, client)
        ).rejects.toThrow('falha de gravação');
    });

    test('exige o client da transação da venda (nunca abre conexão própria)', async () => {
        await expect(
            taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 100 })
        ).rejects.toThrow('exige o client da transação');

        expect(db.query).not.toHaveBeenCalled();
    });

    test('toda consulta de regra usa o client da transação e a empresa recebida (nunca db.query direto)', async () => {
        const client = fakeClient();

        await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 100 }, client);

        expect(db.query).not.toHaveBeenCalled();
        const consultasDeEmpresa = client.query.mock.calls.filter(([sql]) =>
            sql.includes('FROM condicoes_comerciais_empresa') || sql.includes('FROM empresa_planos'));
        expect(consultasDeEmpresa).toHaveLength(2);
        consultasDeEmpresa.forEach(([, params]) => expect(params).toEqual([9]));
    });
});

describe('estornarPorVendaId', () => {
    test('marca como estornada (nunca apaga), só da própria empresa e só se ainda apurada', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };

        const afetadas = await taxasPlataformaRepository.estornarPorVendaId(5, 9, client);

        expect(afetadas).toBe(1);
        const [sql, params] = client.query.mock.calls[0];
        expect(sql).toContain("SET status = 'estornada'");
        expect(sql).toContain('venda_id = $1 AND empresa_id = $2');
        expect(sql).toContain("status = 'apurada'");
        expect(sql).not.toMatch(/DELETE/i);
        expect(params).toEqual([5, 9]);
    });

    test('venda histórica sem taxa é no-op (0 linhas) e não lança', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rowCount: 0 }) };

        await expect(taxasPlataformaRepository.estornarPorVendaId(5, 9, client)).resolves.toBe(0);
    });
});

describe('listarPaginado (leitura administrativa)', () => {
    test('filtra SEMPRE por empresa_id (primeiro parâmetro) e totaliza só as apuradas', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ id: 1, venda_id: 5, valor: '0.15' }] })
            .mockResolvedValueOnce({ rows: [{ quantidade: '1', total_base: '100.00', total_taxa: '0.15' }] });

        const resultado = await taxasPlataformaRepository.listarPaginado({
            limit: 20, offset: 0, empresa_id: 9, data_inicio: '2026-10-01', data_fim: '2026-10-31'
        });

        expect(resultado).toEqual({
            items: [{ id: 1, venda_id: 5, valor: '0.15' }],
            total: 1,
            totais: { total_base: '100.00', total_taxa: '0.15' }
        });

        const [sqlLista, valoresLista] = db.query.mock.calls[0];
        expect(sqlLista).toContain('t.empresa_id = $1');
        expect(sqlLista).toContain('v.empresa_id = t.empresa_id');
        expect(valoresLista[0]).toBe(9);
        expect(valoresLista).toEqual([9, '2026-10-01', '2026-10-31', 20, 0]);

        const [sqlTotais] = db.query.mock.calls[1];
        expect(sqlTotais).toContain("FILTER (WHERE t.status = 'apurada')");
    });

    test('sem período, só empresa_id + paginação', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ quantidade: '0', total_base: '0', total_taxa: '0' }] });

        await taxasPlataformaRepository.listarPaginado({ limit: 20, offset: 0, empresa_id: 9 });

        expect(db.query.mock.calls[0][1]).toEqual([9, 20, 0]);
    });
});
