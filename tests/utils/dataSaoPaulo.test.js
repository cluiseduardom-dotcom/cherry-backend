const { hojeSP, inicioDoMesSP, somarMeses, somarDias, dataDoBanco, SQL_HOJE_SP, sqlDiaSP } = require('../../src/utils/dataSaoPaulo');

describe('hojeSP: o dia de Brasília, não o do servidor (UTC)', () => {
    test.each([
        ['2026-11-13T15:00:00Z', '2026-11-13'],
        ['2026-11-13T23:59:00Z', '2026-11-13'], // 20:59 em Brasília
        ['2026-11-14T00:30:00Z', '2026-11-13'], // 21:30 em Brasília: o servidor já está em 14/11
        ['2026-11-14T02:59:59Z', '2026-11-13'], // 23:59:59 em Brasília
        ['2026-11-14T03:00:00Z', '2026-11-14'], // meia-noite em Brasília
        ['2026-12-01T01:00:00Z', '2026-11-30'], // 22h de 30/11: ainda é novembro
        ['2027-01-01T02:00:00Z', '2026-12-31']  // virada do ano
    ])('agora = %s -> %s', (agora, esperado) => {
        expect(hojeSP(new Date(agora))).toBe(esperado);
    });

    test('início do mês acompanha o dia de Brasília', () => {
        expect(inicioDoMesSP(new Date('2026-12-01T01:00:00Z'))).toBe('2026-11-01');
        expect(inicioDoMesSP(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12-01');
    });
});

describe('somarMeses: calendário puro, dia preservado ou ajustado ao fim do mês', () => {
    test('casos comuns e viradas de ano', () => {
        expect(somarMeses('2026-11-13', 1)).toBe('2026-12-13');
        expect(somarMeses('2026-11-13', 2)).toBe('2027-01-13');
        expect(somarMeses('2026-11-13', 14)).toBe('2028-01-13');
        expect(somarMeses('2026-11-13', 0)).toBe('2026-11-13');
        expect(somarMeses('2026-01-13', -1)).toBe('2025-12-13');
    });

    test('dia que não existe no mês de destino vai para o último dia do mês', () => {
        expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
        expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29'); // bissexto
        expect(somarMeses('2026-03-31', 1)).toBe('2026-04-30');
        expect(somarMeses('2026-08-31', 6)).toBe('2027-02-28');
    });
});

describe('somarDias', () => {
    test('rola mês e ano; sem efeito de fuso', () => {
        expect(somarDias('2026-11-30', 1)).toBe('2026-12-01');
        expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
        expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
        expect(somarDias('2026-11-13', 30)).toBe('2026-12-13');
    });
});

describe('dataDoBanco: DATE lida do pg volta como o mesmo dia gravado', () => {
    test('Date à meia-noite local (como o driver devolve) e texto', () => {
        expect(dataDoBanco(new Date(2026, 10, 13))).toBe('2026-11-13');
        expect(dataDoBanco(new Date(2027, 0, 1))).toBe('2027-01-01');
        expect(dataDoBanco('2026-11-13')).toBe('2026-11-13');
        expect(dataDoBanco('2026-11-13T00:00:00.000Z')).toBe('2026-11-13');
        expect(dataDoBanco(null)).toBeNull();
        expect(dataDoBanco(undefined)).toBeNull();
    });
});

describe('SQL', () => {
    test('hoje e dia de São Paulo; sqlDiaSP só aceita nome de coluna', () => {
        expect(SQL_HOJE_SP).toBe("(NOW() AT TIME ZONE 'America/Sao_Paulo')::date");
        expect(sqlDiaSP('v.data')).toBe("((v.data AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date");
        expect(sqlDiaSP('criado_em')).toContain('criado_em AT TIME ZONE');
        expect(() => sqlDiaSP("data; DROP TABLE vendas")).toThrow(/coluna inválida/);
        expect(() => sqlDiaSP('a.b.c')).toThrow();
    });
});
