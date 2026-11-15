const { avaliarCiclo, sequenciaFinalConsecutiva } = require('../../src/utils/cicloCobranca');
const { obterCicloCobranca } = require('../../src/config/cicloCobrancaConfig');

const config = obterCicloCobranca({});
// Outubro/2026 vence 05/11; carência até 20/11; a suspensão vale a partir de 21/11.
const outubro = (saldo) => ({ competencia: '2026-10', vencimento: '2026-11-05', saldo });
const novembro = (saldo) => ({ competencia: '2026-11', vencimento: '2026-12-05', saldo });
const setembro = (saldo) => ({ competencia: '2026-09', vencimento: '2026-10-05', saldo });
const avaliar = (periodos, hoje) => avaliarCiclo({ periodos, hoje, config });

describe('linha do tempo de um período (R$ 25,00)', () => {
    test.each([
        ['2026-11-03', 'a_vencer', { lembrete: false, aviso: false, suspender: false }],
        ['2026-11-04', 'a_vencer', { lembrete: true, aviso: false, suspender: false }],
        ['2026-11-05', 'a_vencer', { lembrete: true, aviso: false, suspender: false }],
        ['2026-11-06', 'vencido', { lembrete: false, aviso: false, suspender: false }],
        ['2026-11-14', 'vencido', { lembrete: false, aviso: false, suspender: false }],
        ['2026-11-15', 'aviso_suspensao', { lembrete: false, aviso: true, suspender: false }],
        ['2026-11-20', 'aviso_suspensao', { lembrete: false, aviso: true, suspender: false }],
        ['2026-11-21', 'suspensao_devida', { lembrete: false, aviso: false, suspender: true }],
        ['2026-12-30', 'suspensao_devida', { lembrete: false, aviso: false, suspender: true }]
    ])('em %s: %s', (hoje, estagio, flags) => {
        expect(avaliar([outubro(25)], hoje)).toMatchObject({ estagio, ...flags });
    });

    test('vencimento no dia 05 ainda é a vencer; a carência (15 dias) vai até o dia 20 inclusive', () => {
        expect(avaliar([outubro(25)], '2026-11-05').saldo_vencido).toBe(0);
        expect(avaliar([outubro(25)], '2026-11-06').saldo_vencido).toBe(25);
        expect(avaliar([outubro(25)], '2026-11-20').suspender).toBe(false);
        expect(avaliar([outubro(25)], '2026-11-21').suspender).toBe(true);
    });

    test('o dia em que a suspensão começa fica informado antes e depois de valer', () => {
        expect(avaliar([outubro(25)], '2026-11-10').suspensao_em).toBe('2026-11-21');
        expect(avaliar([outubro(25)], '2026-11-21').suspensao_em).toBe('2026-11-21');
        expect(avaliar([outubro(25)], '2026-12-30').suspensao_em).toBe('2026-11-21');
        expect(avaliar([outubro(9)], '2026-12-30').suspensao_em).toBeNull(); // abaixo do piso: nunca
    });

    test('sem saldo: em dia', () => {
        expect(avaliar([], '2026-11-10')).toMatchObject({ estagio: 'em_dia', cobravel: false, suspender: false });
        expect(avaliar([outubro(0)], '2026-11-10').estagio).toBe('em_dia');
    });
});

describe('piso de cobrança (T8)', () => {
    test('R$ 9,99 vencido e fora da carência: não é cobrável, não avisa, não suspende', () => {
        const r = avaliar([outubro(9.99)], '2026-11-25');
        expect(r).toMatchObject({ estagio: 'abaixo_do_piso', cobravel: false, aviso: false, suspender: false, lembrete: false, motivo_cobranca: null });
        expect(r.saldo_vencido).toBe(9.99);
    });

    test('R$ 10,00 já é cobrável (o piso é inclusivo)', () => {
        expect(avaliar([outubro(10)], '2026-11-25')).toMatchObject({ cobravel: true, suspender: true, motivo_cobranca: 'piso' });
    });

    test('lembrete antes do vencimento também respeita o piso', () => {
        expect(avaliar([outubro(9.99)], '2026-11-05').lembrete).toBe(false);
        expect(avaliar([outubro(10)], '2026-11-05').lembrete).toBe(true);
    });

    test('o saldo vencido acumula de um mês para o outro e cruza o piso', () => {
        // R$ 6,00 de setembro + R$ 5,00 de outubro, ambos vencidos: 11,00 >= piso.
        const r = avaliar([setembro(6), outubro(5)], '2026-11-10');
        expect(r).toMatchObject({ saldo_vencido: 11, cobravel: true, motivo_cobranca: 'piso' });
    });

    test('só suspende quando o que passou da carência soma o piso: mês novo ainda em carência não suspende pelo antigo', () => {
        // Setembro (R$ 4,00) passou da carência há muito; outubro (R$ 7,00) venceu em 05/11 e está em carência.
        const emCarencia = avaliar([setembro(4), outubro(7)], '2026-11-10');
        expect(emCarencia).toMatchObject({ saldo_vencido: 11, saldo_apos_carencia: 4, cobravel: true, suspender: false });
        // Passada a carência de outubro, os dois somam 11 >= piso.
        expect(avaliar([setembro(4), outubro(7)], '2026-11-21')).toMatchObject({ saldo_apos_carencia: 11, suspender: true });
    });

    test('aviso só vem se a suspensão realmente vai acontecer no fim da carência', () => {
        // R$ 25 de outubro: aviso a partir de 15/11. R$ 9 de outubro: nunca (abaixo do piso).
        expect(avaliar([outubro(25)], '2026-11-15').aviso).toBe(true);
        expect(avaliar([outubro(9)], '2026-11-15').aviso).toBe(false);
        // Setembro R$ 4,00 (carência esgotada) + outubro R$ 7,00 (fim da carência em 20/11): a soma só fecha o piso no dia 20.
        const r = avaliar([setembro(4), outubro(7)], '2026-11-16');
        expect(r).toMatchObject({ aviso: true, suspender: false, suspensao_em: '2026-11-21' });
        expect(avaliar([setembro(4), outubro(7)], '2026-11-14').aviso).toBe(false);
    });
});

describe('3 períodos consecutivos abaixo do piso (T8)', () => {
    const julho = { competencia: '2026-07', vencimento: '2026-08-05', saldo: 2 };
    const agosto = { competencia: '2026-08', vencimento: '2026-09-05', saldo: 3 };
    const setembro3 = { competencia: '2026-09', vencimento: '2026-10-05', saldo: 1.5 };
    const outubro3 = { competencia: '2026-10', vencimento: '2026-11-05', saldo: 2 };

    test('dois meses abaixo do piso: continua acumulando, sem cobrar', () => {
        expect(avaliar([setembro3, outubro3], '2026-11-25')).toMatchObject({ estagio: 'abaixo_do_piso', cobravel: false, periodos_vencidos: 2 });
    });

    test('três meses seguidos abaixo do piso: cobra mesmo assim, mas nunca suspende', () => {
        const r = avaliar([agosto, setembro3, outubro3], '2026-11-25');
        expect(r).toMatchObject({ estagio: 'vencido', cobravel: true, motivo_cobranca: 'tres_periodos', suspender: false, aviso: false, periodos_vencidos: 3 });
        expect(r.saldo_vencido).toBe(6.5);
    });

    test('quatro meses seguidos continuam sem suspensão enquanto a soma ficar abaixo do piso', () => {
        const r = avaliar([julho, agosto, setembro3, outubro3], '2026-11-25');
        expect(r).toMatchObject({ cobravel: true, motivo_cobranca: 'tres_periodos', suspender: false, periodos_vencidos: 4 });
    });

    test('meses não consecutivos não contam como sequência', () => {
        const r = avaliar([julho, setembro3, outubro3], '2026-11-25');
        expect(r).toMatchObject({ cobravel: false, estagio: 'abaixo_do_piso', periodos_vencidos: 2 });
    });

    test('a sequência é a que termina no mês vencido mais recente', () => {
        const fev = { competencia: '2026-02', vencimento: '2026-03-05', saldo: 1 };
        expect(sequenciaFinalConsecutiva([fev, agosto, setembro3, outubro3].map((p) => ({ competencia: p.competencia })))).toBe(3);
        expect(sequenciaFinalConsecutiva([])).toBe(0);
    });
});

describe('parâmetros configuráveis', () => {
    test('outra carência e outro piso mudam o ciclo sem mexer no código', () => {
        const curta = obterCicloCobranca({ COBRANCA_CARENCIA_DIAS: '5', COBRANCA_PISO: '50' });
        const av = (saldo, hoje) => avaliarCiclo({ periodos: [outubro(saldo)], hoje, config: curta });
        expect(av(49.99, '2026-11-20').cobravel).toBe(false);
        expect(av(50, '2026-11-10').suspender).toBe(false);
        expect(av(50, '2026-11-11').suspender).toBe(true);
    });
});

describe('arredondamento', () => {
    test('soma em centavos inteiros, sem resíduo de ponto flutuante', () => {
        // 0,1 + 0,2 não pode virar 0,30000000000000004 nem deixar o piso torto.
        const r = avaliar([setembro(0.1), outubro(0.2)], '2026-11-25');
        expect(r.saldo_vencido).toBe(0.3);
    });
});

describe('suspensao_em é consistente com suspender (amostragem)', () => {
    // suspender  <=>  suspensao_em preenchido e hoje >= suspensao_em. Garante que o painel (que mostra a data) e o
    // bloqueio (que usa suspender) nunca discordam. Pseudoaleatório com semente fixa: reproduzível.
    function gerador(semente) {
        let s = semente;
        return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    }

    test('em 4.000 cenários de meses, saldos e datas', () => {
        const rnd = gerador(20261115);
        const meses = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
        const vence = (m) => { const [a, mm] = m.split('-').map(Number); const d = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}`; return `${d}-05`; };
        let suspensos = 0;

        for (let i = 0; i < 4000; i += 1) {
            const periodos = meses.filter(() => rnd() < 0.5).map((m) => ({ competencia: m, vencimento: vence(m), saldo: Math.round(rnd() * 2500) / 100 }));
            const dia = 1 + Math.floor(rnd() * 120);
            const hoje = new Date(Date.UTC(2026, 9, 1 + dia)).toISOString().slice(0, 10);
            const r = avaliar(periodos, hoje);

            expect(r.suspender).toBe(r.suspensao_em !== null && hoje >= r.suspensao_em);
            if (r.suspender) { suspensos += 1; expect(r.saldo_apos_carencia).toBeGreaterThanOrEqual(10); }
            if (r.saldo_vencido < 10) expect(r.suspender).toBe(false); // abaixo do piso nunca suspende
        }
        expect(suspensos).toBeGreaterThan(100); // o cenário exercita mesmo a suspensão
    });
});
