jest.mock('../../src/config/db');

const db = require('../../src/config/db');
const taxasPlataformaRepository = require('../../src/repositories/taxasPlataformaRepository');

const POLITICA = { id: 1, tipo: 'percentual', percentual: '0.1500' };

function fakeClient({ politica = POLITICA } = {}) {
    const client = { query: jest.fn() };

    client.query.mockImplementation((sql) => {
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

beforeEach(() => jest.clearAllMocks());

describe('buscarPoliticaVigente', () => {
    test('só considera política ativa e dentro da vigência, com "hoje" calculado no banco em America/Sao_Paulo', async () => {
        const client = fakeClient();

        const politica = await taxasPlataformaRepository.buscarPoliticaVigente(client);

        expect(politica).toEqual(POLITICA);
        const [sql] = client.query.mock.calls[0];
        expect(sql).toContain('ativo = true');
        expect(sql).toContain('vigencia_inicio <=');
        expect(sql).toContain('vigencia_fim IS NULL OR vigencia_fim >=');
        expect(sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
        expect(sql).not.toContain('empresa_id'); // política é global da plataforma
    });

    test('devolve null quando não há política vigente', async () => {
        expect(await taxasPlataformaRepository.buscarPoliticaVigente(fakeClient({ politica: null }))).toBeNull();
    });
});

describe('apurar', () => {
    test('R$ 100,00 a 0,15%: grava UMA linha com R$ 0,15 e congela tipo, percentual e política usada', async () => {
        const client = fakeClient();

        const resultado = await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 100 }, client);

        expect(resultado).toEqual({ id: 77 });
        expect(insertDe(client)).toEqual([5, 9, 1, 'percentual', '0.1500', '100.00', '0.15']);
        expect(client.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO taxas_venda'))).toHaveLength(1);
    });

    test('R$ 1,00: taxa R$ 0,00 (R$ 0,0015 arredondado), sem mínimo artificial', async () => {
        const client = fakeClient();

        await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 1 }, client);

        expect(insertDe(client)).toEqual([5, 9, 1, 'percentual', '0.1500', '1.00', '0.00']);
    });

    test('usa o total FINAL da venda recebido (já com desconto e acréscimo) sem somar nada de novo', async () => {
        const client = fakeClient();

        // subtotal 100 - desconto 10 + juros 5 = 95 (calculado por vendasRepository)
        await taxasPlataformaRepository.apurar({ venda_id: 5, empresa_id: 9, total: 95 }, client);

        expect(insertDe(client)[5]).toBe('95.00');
        expect(insertDe(client)[6]).toBe('0.14'); // 9500 * 0,0015 = 14,25 -> 14 centavos
    });

    test('sem política vigente: lança erro 500 e não grava nada', async () => {
        const client = fakeClient({ politica: null });

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
        client.query.mockImplementation((sql) => {
            if (sql.includes('FROM politicas_taxa_plataforma')) return Promise.resolve({ rows: [POLITICA] });
            return Promise.reject(new Error('falha de gravação'));
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
