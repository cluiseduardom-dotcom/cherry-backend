const { montarNotificacoesCobranca, TIPO_COBRANCA } = require('../../src/utils/notificacoesCobranca');
const { obterCicloCobranca } = require('../../src/config/cicloCobrancaConfig');
const { avaliarCiclo } = require('../../src/utils/cicloCobranca');

const ADMIN = { administrador: true };
const config = obterCicloCobranca({ COBRANCA_SUSPENSAO_PIX: 'ligada' });
// Outubro/2026 (R$ 25,00) vence 05/11; carência até 20/11; aviso a partir de 15/11; Pix suspenso a partir de 21/11.
const situacaoEm = (hoje, saldo = 25) => {
    const ciclo = avaliarCiclo({ periodos: [{ competencia: '2026-10', vencimento: '2026-11-05', saldo }], hoje, config });
    return { ativa: true, suspenso: ciclo.suspender, desde: ciclo.suspensao_em, ciclo };
};

describe('aviso de cobrança da plataforma no sino', () => {
    test('aviso a partir de 5 dias antes: valor, data-limite e que dinheiro e cartão seguem', () => {
        const [a] = montarNotificacoesCobranca(situacaoEm('2026-11-15'), ADMIN);

        expect(a).toMatchObject({
            id: `${TIPO_COBRANCA}:aviso:2026-11-21`, tipo: 'cobranca_plataforma', prioridade: 'alta', item: 'cobranca',
            produto_id: null, sku: null, nome: null, titulo: 'Pix da loja será suspenso',
            acao: 'Falar com a GiroNex para regularizar o pagamento.',
            dados: { saldo_vencido: 25, suspensao_em: '2026-11-21' }
        });
        expect(a.mensagem).toMatch(/pendência de R\$\s25,00 com a GiroNex\. Se não for paga até 20\/11\/2026, o Pix da loja será suspenso\. Dinheiro e cartão seguem normais\./);
    });

    test('Pix já suspenso: diz que está suspenso e que volta ao registrar o pagamento', () => {
        const [a] = montarNotificacoesCobranca(situacaoEm('2026-11-25'), ADMIN);

        expect(a).toMatchObject({ id: 'cobranca_plataforma:suspenso:2026-11-21', titulo: 'Pix da loja suspenso', prioridade: 'alta' });
        expect(a.mensagem).toMatch(/O Pix da loja está suspenso por uma pendência de R\$\s25,00 com a GiroNex\. Dinheiro e cartão seguem normais\. O Pix volta assim que o pagamento for registrado\./);
    });

    test.each([
        ['antes do vencimento (dia 4)', '2026-11-04'],
        ['logo depois de vencer (dia 6)', '2026-11-06'],
        ['carência, antes dos 5 dias (dia 14)', '2026-11-14']
    ])('só quando importa: sem aviso %s', (_nome, hoje) => {
        expect(montarNotificacoesCobranca(situacaoEm(hoje), ADMIN)).toEqual([]);
    });

    test('aviso e suspenso mudam de id: o episódio novo volta como "novo" mesmo que o anterior tenha sido lido', () => {
        const ids = ['2026-11-15', '2026-11-25'].map((d) => montarNotificacoesCobranca(situacaoEm(d), ADMIN)[0].id);
        expect(new Set(ids).size).toBe(2);
    });

    test('SÓ o administrador: vendedor, estoquista e perfil ausente não recebem', () => {
        const s = situacaoEm('2026-11-25');
        expect(montarNotificacoesCobranca(s, { administrador: false, vendedor: true })).toEqual([]);
        expect(montarNotificacoesCobranca(s, { administrador: false, estoquista: true })).toEqual([]);
        expect(montarNotificacoesCobranca(s, {})).toEqual([]);
        expect(montarNotificacoesCobranca(s, undefined)).toEqual([]);
    });

    test('suspensão DESLIGADA (ou sem dado): nunca avisa, porque o aviso seria falso', () => {
        expect(montarNotificacoesCobranca({ ativa: false, suspenso: false }, ADMIN)).toEqual([]);
        expect(montarNotificacoesCobranca({ ativa: true, suspenso: false }, ADMIN)).toEqual([]);
        expect(montarNotificacoesCobranca(null, ADMIN)).toEqual([]);
    });

    test('abaixo do piso nunca avisa, mesmo muito depois', () => {
        expect(montarNotificacoesCobranca(situacaoEm('2026-12-30', 9.99), ADMIN)).toEqual([]);
    });

    test('nunca traz percentual, taxa por venda, nem detalhe de venda', () => {
        const a = montarNotificacoesCobranca(situacaoEm('2026-11-25'), ADMIN)[0];
        expect(Object.keys(a.dados).sort()).toEqual(['saldo_vencido', 'suspensao_em']);
        expect(JSON.stringify(a)).not.toMatch(/percentual|0,50|taxa|venda_id|pix_manual|pix_mp/i);
    });
});
