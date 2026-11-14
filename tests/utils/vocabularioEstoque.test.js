const { VOCABULARIOS, CHAVES_VOCABULARIO, PADRAO_EMPRESA_EXISTENTE, PADRAO_EMPRESA_NOVA, vocabularioEstoque } = require('../../src/constants/vocabularioEstoque');
const { montarNotificacoesMaleta } = require('../../src/utils/notificacoesMaleta');

describe('vocabulário do estoque do vendedor', () => {
    test('lista fechada: maleta e estoque_vendedor; empresa existente = maleta, nova = estoque_vendedor', () => {
        expect(CHAVES_VOCABULARIO).toEqual(['maleta', 'estoque_vendedor']);
        expect(PADRAO_EMPRESA_EXISTENTE).toBe('maleta');
        expect(PADRAO_EMPRESA_NOVA).toBe('estoque_vendedor');
    });

    test('cada opção traz frases já concordadas (sem "o maleta" nem "da estoque")', () => {
        expect(vocabularioEstoque('maleta')).toMatchObject({ nome: 'Maleta', plural: 'Maletas', minha: 'Minha maleta', da: 'da maleta', na: 'na maleta', daSuaPropria: 'da sua própria maleta' });
        expect(vocabularioEstoque('estoque_vendedor')).toMatchObject({ nome: 'Estoque do vendedor', plural: 'Estoques dos vendedores', minha: 'Meu estoque', da: 'do estoque do vendedor', na: 'no estoque do vendedor', daSuaPropria: 'do seu próprio estoque' });
        expect(vocabularioEstoque('maleta').daPessoa('Ana')).toBe('Maleta de Ana');
        expect(vocabularioEstoque('estoque_vendedor').daPessoa('Ana')).toBe('Estoque de Ana');
    });

    test('chave desconhecida, nula ou ausente cai em maleta (comportamento anterior, nunca quebra)', () => {
        for (const ruim of [undefined, null, '', 'qualquer']) expect(vocabularioEstoque(ruim)).toBe(VOCABULARIOS.maleta);
    });
});

describe('avisos do sino com o vocabulário da empresa', () => {
    const perfil = { administrador: true };
    const base = { maletas: [{ local_id: 3, nome: 'Estoque de Ana', usuario_id: 9, saldo_total: 4, dias_sem_venda: 40, dias_sem_conferencia: 45, conferencia_divergente_id: null, itens_divergentes: 0 }] };
    const textos = (vocab) => montarNotificacoesMaleta(base, perfil, 1, vocab).map((a) => `${a.titulo} | ${a.acao}`);

    test('sem vocabulário (padrão) o texto é o de sempre, de maleta', () => {
        expect(textos(undefined)).toEqual(['Maleta sem conferência | Conferir a maleta (contagem física).', 'Maleta sem vender | Avaliar a troca de peças ou a devolução ao Central.']);
    });

    test('estoque do vendedor: título e ação concordam', () => {
        expect(textos(vocabularioEstoque('estoque_vendedor'))).toEqual(['Estoque do vendedor sem conferência | Conferir o estoque do vendedor (contagem física).', 'Estoque do vendedor sem vender | Avaliar a troca de peças ou a devolução ao Central.']);
    });

    test('vendedor dono: "combinar a conferência ..." concorda', () => {
        const vend = montarNotificacoesMaleta(base, { vendedor: true }, 9, vocabularioEstoque('estoque_vendedor')).map((a) => a.acao);

        expect(vend[0]).toBe('Combinar a conferência do estoque do vendedor com a equipe.');
    });
});
