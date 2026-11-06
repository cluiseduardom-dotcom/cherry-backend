const { montarNotificacoesMaleta, LIMITES_MALETA } = require('../../src/utils/notificacoesMaleta');
const { montarNotificacoes } = require('../../src/utils/notificacoes');

const admin = { administrador: true, estoquista: false };
const estoquista = { administrador: false, estoquista: true };
const vendedor = { administrador: false, estoquista: false };

const maleta = (extra) => ({
    local_id: 5, nome: 'Maleta Ana', usuario_id: 10, saldo_total: 12,
    dias_sem_venda: 3, dias_sem_conferencia: 3, conferencia_divergente_id: null, itens_divergentes: null, ...extra
});
const pendente = (extra) => ({ id: 9, origem_nome: 'Central', destino_nome: 'Maleta Ana', destino_usuario_id: 10, pecas: 4, dias: 3, ...extra });
const tipos = (itens) => itens.map((i) => i.tipo);

describe('montarNotificacoesMaleta', () => {
    test('tudo em dia não gera aviso', () => {
        expect(montarNotificacoesMaleta({ maletas: [maleta()], pendentes: [pendente({ dias: 1 })] }, admin, 1)).toEqual([]);
    });

    test('transferência pendente há ≥ 2 dias: alta; para o dono fala em "seu aceite", para a equipe em cobrar', () => {
        const [dono] = montarNotificacoesMaleta({ pendentes: [pendente()] }, vendedor, 10);
        expect(dono).toMatchObject({ tipo: 'transferencia_pendente', prioridade: 'alta', id: 'transferencia_pendente:9', transferencia_id: 9, produto_id: null });
        expect(dono.mensagem).toContain('seu aceite');
        const [equipe] = montarNotificacoesMaleta({ pendentes: [pendente()] }, estoquista, 2);
        expect(equipe.mensagem).toContain('Central → Maleta Ana');
        expect(equipe.acao).toMatch(/Cobrar/);
        expect(montarNotificacoesMaleta({ pendentes: [pendente({ dias: LIMITES_MALETA.TRANSFERENCIA_PENDENTE_DIAS - 1 })] }, admin, 1)).toEqual([]);
    });

    test('vendedor não vê transferência pendente de outra pessoa nem maleta alheia', () => {
        const dados = { maletas: [maleta({ usuario_id: 11, dias_sem_venda: 40 })], pendentes: [pendente({ destino_usuario_id: 11 })] };
        expect(montarNotificacoesMaleta(dados, vendedor, 10)).toEqual([]);
    });

    test('maleta sem venda e sem conferência no limite (30 dias), com saldo', () => {
        const itens = montarNotificacoesMaleta({ maletas: [maleta({ dias_sem_venda: 30, dias_sem_conferencia: 45 })] }, admin, 1);
        expect(tipos(itens)).toEqual(['maleta_sem_conferencia', 'maleta_sem_venda']);
        expect(itens[1].mensagem).toBe('Maleta Ana tem 12 peças e está há 30 dias sem vender.');
        expect(itens[0].dados).toEqual({ saldo: 12, dias_sem_conferencia: 45 });
        expect(itens[0]).toMatchObject({ local_id: 5, item: 'maleta', produto_id: null, nome: null });
    });

    test('29 dias não alerta; sem saldo não alerta; sem referência (null) não alerta', () => {
        expect(montarNotificacoesMaleta({ maletas: [maleta({ dias_sem_venda: 29, dias_sem_conferencia: 29 })] }, admin, 1)).toEqual([]);
        expect(montarNotificacoesMaleta({ maletas: [maleta({ saldo_total: 0, dias_sem_venda: 90, dias_sem_conferencia: 90 })] }, admin, 1)).toEqual([]);
        expect(montarNotificacoesMaleta({ maletas: [maleta({ dias_sem_venda: null, dias_sem_conferencia: null })] }, admin, 1)).toEqual([]);
    });

    test('o dono recebe os avisos da própria maleta, com ação adequada (não pode conferir)', () => {
        const itens = montarNotificacoesMaleta({ maletas: [maleta({ dias_sem_conferencia: 40 })] }, vendedor, 10);
        expect(tipos(itens)).toEqual(['maleta_sem_conferencia']);
        expect(itens[0].acao).toMatch(/equipe/);
    });

    test('divergência de conferência: alta e só para a equipe', () => {
        const m = maleta({ conferencia_divergente_id: 77, itens_divergentes: 2 });
        const [aviso] = montarNotificacoesMaleta({ maletas: [m] }, admin, 1);
        expect(aviso).toMatchObject({ tipo: 'maleta_divergencia', prioridade: 'alta', dados: { conferencia_id: 77, itens_divergentes: 2 } });
        expect(montarNotificacoesMaleta({ maletas: [m] }, vendedor, 10)).toEqual([]);
    });

    test('nenhum aviso traz custo, margem ou lucro', () => {
        const itens = montarNotificacoesMaleta({
            maletas: [maleta({ dias_sem_venda: 50, dias_sem_conferencia: 50, conferencia_divergente_id: 1, itens_divergentes: 1 })],
            pendentes: [pendente()]
        }, admin, 1);
        expect(JSON.stringify(itens)).not.toMatch(/custo|margem|lucro/i);
    });
});

describe('montarNotificacoes com extras de maleta', () => {
    const prod = { id: 1, sku: 'A', nome: 'Anel', tipo: 'acabado', estoque_atual: 0, estoque_minimo: 3, vendido_30d: 0, vendido_90d: 0, dias_sem_venda: 3, dias_cadastro: 200 };

    test('entram na ordenação por prioridade: alta antes de média, produtos antes de avisos sem produto', () => {
        const extras = montarNotificacoesMaleta({ maletas: [maleta({ dias_sem_venda: 40 })], pendentes: [pendente()] }, admin, 1);
        const itens = montarNotificacoes([prod], admin, [], extras);
        expect(tipos(itens)).toEqual(['falta', 'transferencia_pendente', 'maleta_sem_venda']);
    });

    test('sem extras o comportamento é o de sempre', () => {
        expect(tipos(montarNotificacoes([prod], admin))).toEqual(['falta']);
    });

    test('o teto de 50 vale para tudo junto: prioridade alta de maleta entra antes de avisos baixos de produto', () => {
        const parado = { ...prod, estoque_atual: 5, estoque_minimo: 0, dias_sem_venda: 150, dias_cadastro: 300 };
        const muitos = Array.from({ length: 60 }, (_, i) => ({ ...parado, id: i + 1 }));
        const extras = montarNotificacoesMaleta({ pendentes: [pendente({ id: 900 })] }, admin, 1);
        const itens = montarNotificacoes(muitos, admin, [], extras);
        expect(itens).toHaveLength(50);
        expect(tipos(itens)).toContain('transferencia_pendente');
    });
});
