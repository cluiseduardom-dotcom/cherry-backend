const { montarNotificacoesProducao, quantidadeLegivel } = require('../../src/utils/notificacoesProducao');
const { montarNotificacoes } = require('../../src/utils/notificacoes');

const admin = { administrador: true, estoquista: false };
const estoquista = { administrador: false, estoquista: true };
const vendedor = { administrador: false, estoquista: false };

const pend = (extra) => ({ produto_id: 7, sku: 'FAR-001', nome: 'Farinha', unidade: 'G', quantidade_pendente: 1250, ordens: 2, ...extra });

describe('quantidadeLegivel', () => {
    test('g/ml viram kg/L a partir de 1000; demais unidades seguem em números', () => {
        expect(quantidadeLegivel(250, 'G')).toBe('250 g');
        expect(quantidadeLegivel(1250, 'G')).toBe('1,25 kg');
        expect(quantidadeLegivel(300, 'ML')).toBe('300 ml');
        expect(quantidadeLegivel(2000, 'ML')).toBe('2 L');
        expect(quantidadeLegivel(3, 'UN')).toBe('3 un.');
    });
});

describe('montarNotificacoesProducao', () => {
    test('um aviso de prioridade alta por insumo, com nome, SKU, quantidade e ação', () => {
        const [aviso] = montarNotificacoesProducao([pend()], admin);

        expect(aviso).toMatchObject({
            id: 'insumo_pendente_producao:7', tipo: 'insumo_pendente_producao', prioridade: 'alta', produto_id: 7, sku: 'FAR-001', nome: 'Farinha',
            titulo: 'Insumo pendente na produção', dados: { quantidade_pendente: 1250, ordens: 2 }
        });
        expect(aviso.mensagem).toBe('Farinha (SKU FAR-001) ficou sem baixa em 2 ordem(ns) de produção: 1,25 kg.');
        expect(aviso.acao).toMatch(/Regularizar insumos/);
    });

    test('sem SKU usa só o nome; sem pendência não há aviso', () => {
        expect(montarNotificacoesProducao([pend({ sku: null })], admin)[0].mensagem).toMatch(/^Farinha ficou/);
        expect(montarNotificacoesProducao([], admin)).toEqual([]);
    });

    test('admin e estoquista recebem; vendedor nunca', () => {
        expect(montarNotificacoesProducao([pend()], estoquista)).toHaveLength(1);
        expect(montarNotificacoesProducao([pend()], vendedor)).toEqual([]);
    });

    test('entra no sino junto dos outros avisos, na ordem de prioridade', () => {
        const extras = montarNotificacoesProducao([pend()], admin);
        const itens = montarNotificacoes([], admin, [], extras);

        expect(itens.map((i) => i.tipo)).toEqual(['insumo_pendente_producao']);
    });
});
