const { montarNotificacoes, LIMITES } = require('../../src/utils/notificacoes');

const admin = { administrador: true, estoquista: false };
const estoquista = { administrador: false, estoquista: true };
const vendedor = { administrador: false, estoquista: false };

const prod = (extra) => ({
    id: 1, sku: 'ANE-001', nome: 'Anel', tipo: 'acabado',
    estoque_atual: 20, estoque_minimo: 0, vendido_30d: 0, vendido_90d: 0,
    dias_sem_venda: 5, dias_cadastro: 200, ...extra
});
const tipos = (itens) => itens.map((i) => i.tipo);

describe('montarNotificacoes', () => {
    test('estoque zerado com mínimo definido vira "falta" (alta) com SKU e ação', () => {
        const [n] = montarNotificacoes([prod({ estoque_atual: 0, estoque_minimo: 5 })], admin);
        expect(n).toMatchObject({ tipo: 'falta', prioridade: 'alta', sku: 'ANE-001', id: 'falta:1' });
        expect(n.mensagem).toContain('SKU ANE-001');
        expect(n.acao).toBeTruthy();
    });

    test('estoque zerado sem mínimo e sem venda recente não gera aviso', () => {
        expect(montarNotificacoes([prod({ estoque_atual: 0 })], admin)).toEqual([]);
    });

    test('estoque zerado que vendeu nos últimos 90 dias gera falta mesmo sem mínimo', () => {
        expect(tipos(montarNotificacoes([prod({ estoque_atual: 0, vendido_90d: 4 })], admin))).toEqual(['falta']);
    });

    test('estoque no mínimo (<=) vira "abaixo_minimo" e não duplica com "perto_de_acabar"', () => {
        const itens = montarNotificacoes([prod({ estoque_atual: 5, estoque_minimo: 5, vendido_30d: 30 })], admin);
        expect(tipos(itens)).toEqual(['abaixo_minimo']);
    });

    test('cobertura <= 7 dias vira "perto_de_acabar"; acima disso não', () => {
        // 30 vendidos em 30 dias = 1/dia; 7 em estoque = 7 dias
        expect(tipos(montarNotificacoes([prod({ estoque_atual: 7, vendido_30d: 30, vendido_90d: 30 })], admin)))
            .toContain('perto_de_acabar');
        expect(tipos(montarNotificacoes([prod({ estoque_atual: 8, vendido_30d: 30, vendido_90d: 30 })], admin)))
            .not.toContain('perto_de_acabar');
    });

    test('produto sem venda há 90+ dias e cadastrado há 90+ dias é "parado"', () => {
        const itens = montarNotificacoes([prod({ dias_sem_venda: 120 })], admin);
        expect(itens).toHaveLength(1);
        expect(itens[0]).toMatchObject({ tipo: 'parado', prioridade: 'baixa' });
        expect(itens[0].dados.dias_sem_venda).toBe(120);
    });

    test('produto novo (cadastrado há menos de 90 dias) sem venda não é "parado"', () => {
        expect(montarNotificacoes([prod({ dias_sem_venda: null, dias_cadastro: 10 })], admin)).toEqual([]);
    });

    test('produto que nunca vendeu e é antigo é "parado"', () => {
        const [n] = montarNotificacoes([prod({ dias_sem_venda: null })], admin);
        expect(n.tipo).toBe('parado');
        expect(n.mensagem).toContain('nunca foi vendido');
    });

    test('alto giro: só giro >= 1, limitado ao top 3, ordenado por giro', () => {
        const produtos = [
            prod({ id: 1, estoque_atual: 10, vendido_90d: 10, vendido_30d: 1 }),
            prod({ id: 2, estoque_atual: 10, vendido_90d: 50, vendido_30d: 1 }),
            prod({ id: 3, estoque_atual: 10, vendido_90d: 30, vendido_30d: 1 }),
            prod({ id: 4, estoque_atual: 10, vendido_90d: 20, vendido_30d: 1 }),
            prod({ id: 5, estoque_atual: 10, vendido_90d: 9, vendido_30d: 1 })
        ];
        const giro = montarNotificacoes(produtos, admin).filter((i) => i.tipo === 'alto_giro');
        expect(giro.map((i) => i.produto_id)).toEqual([2, 3, 4]);
        expect(LIMITES.TOP_GIRO_QUANTIDADE).toBe(3);
    });

    test('insumo aparece só em falta/abaixo do mínimo/perto de acabar, nunca parado nem giro', () => {
        const insumo = prod({ id: 9, nome: 'Caixinha', tipo: 'insumo', dias_sem_venda: null, vendido_90d: 0 });
        expect(montarNotificacoes([insumo], admin)).toEqual([]);
        const [n] = montarNotificacoes([{ ...insumo, estoque_atual: 0, estoque_minimo: 10 }], admin);
        expect(n).toMatchObject({ tipo: 'falta', item: 'insumo' });
    });

    test('ordena por prioridade (alta antes de baixa)', () => {
        const itens = montarNotificacoes([
            prod({ id: 1, dias_sem_venda: 200 }),
            prod({ id: 2, estoque_atual: 0, estoque_minimo: 3 })
        ], admin);
        expect(tipos(itens)).toEqual(['falta', 'parado']);
    });

    describe('RBAC por perfil', () => {
        const produtos = [
            prod({ id: 1, estoque_atual: 0, estoque_minimo: 3 }),
            prod({ id: 2, estoque_atual: 7, vendido_30d: 30, vendido_90d: 30 }),
            prod({ id: 3, dias_sem_venda: 300 }),
            prod({ id: 4, estoque_atual: 10, vendido_90d: 40, vendido_30d: 10 }),
            prod({ id: 5, nome: 'Sacola', tipo: 'insumo', estoque_atual: 0, estoque_minimo: 5 })
        ];

        test('estoquista recebe falta e perto de acabar (inclui insumo), sem parado nem giro', () => {
            const t = new Set(tipos(montarNotificacoes(produtos, estoquista)));
            expect(t.has('falta')).toBe(true);
            expect(t.has('perto_de_acabar')).toBe(true);
            expect(t.has('parado')).toBe(false);
            expect(t.has('alto_giro')).toBe(false);
        });

        test('vendedor recebe só falta/abaixo do mínimo de produtos, nunca insumo', () => {
            const itens = montarNotificacoes(produtos, vendedor);
            expect(itens.every((i) => ['falta', 'abaixo_minimo'].includes(i.tipo))).toBe(true);
            expect(itens.some((i) => i.item === 'insumo')).toBe(false);
        });

        test('nenhum perfil recebe custo, margem ou lucro', () => {
            const json = JSON.stringify(montarNotificacoes(produtos, admin));
            expect(json).not.toMatch(/custo|margem|lucro/i);
        });
    });

    describe('insumo_pendente (consumo da venda sem saldo)', () => {
        const pendencias = [{ produto_id: 7, sku: 'TAG-1', nome: 'Tag logo', quantidade_pendente: 3, vendas: 2 }];

        test('admin e estoquista recebem, com SKU, quantidade e prioridade alta', () => {
            for (const perfil of [admin, estoquista]) {
                const [n] = montarNotificacoes([], perfil, pendencias);
                expect(n).toMatchObject({ tipo: 'insumo_pendente', prioridade: 'alta', sku: 'TAG-1', item: 'insumo', id: 'insumo_pendente:7' });
                expect(n.mensagem).toContain('SKU TAG-1');
                expect(n.dados).toEqual({ quantidade_pendente: 3, vendas: 2 });
            }
        });

        test('vendedor nunca recebe', () => {
            expect(montarNotificacoes([], vendedor, pendencias)).toEqual([]);
        });

        test('sem pendências (ou omitido) não gera aviso', () => {
            expect(montarNotificacoes([], admin, [])).toEqual([]);
            expect(montarNotificacoes([], admin)).toEqual([]);
        });
    });

    test('limita o total de itens', () => {
        const muitos = Array.from({ length: 80 }, (_, i) => prod({ id: i + 1, estoque_atual: 0, estoque_minimo: 1 }));
        expect(montarNotificacoes(muitos, admin)).toHaveLength(LIMITES.MAXIMO_ITENS);
    });
});
