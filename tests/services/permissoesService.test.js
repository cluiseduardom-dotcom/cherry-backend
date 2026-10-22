const { resolverCargo, temCapacidade, podeVerCustos, podeVerCustosOperacionais, podeVerVendasDeTodos } =
    require('../../src/services/permissoesService');
const { CARGOS, CATALOGO, TODAS_CAPACIDADES } = require('../../src/constants/cargos');

describe('resolverCargo — padrão do catálogo (comércio sem linha em cargos_empresa)', () => {
    test('só os cargos básicos estão ligados por padrão', () => {
        const ativos = CARGOS.filter((cargo) => resolverCargo(cargo, null).ativo).sort();

        expect(ativos).toEqual(['admin', 'estoquista', 'vendedor']);
    });

    test('Admin: nível máximo, todas as capacidades, perfil admin', () => {
        expect(resolverCargo('admin', null)).toMatchObject({
            role: 'admin', nivel: 90, ativo: true, administrador: true, capacidades: TODAS_CAPACIDADES
        });
    });

    test('Admin não é alterável nem por uma linha forjada em cargos_empresa', () => {
        const forjada = { nivel: 1, ativo: false, capacidades: [] };

        expect(resolverCargo('admin', forjada)).toMatchObject({ nivel: 90, ativo: true, administrador: true });
    });

    test('Vendedor, Estoquista e Admin mantêm exatamente o perfil de antes', () => {
        expect(resolverCargo('vendedor', null).role).toBe('vendedor');
        expect(resolverCargo('estoquista', null).role).toBe('estoquista');
        expect(resolverCargo('admin', null).role).toBe('admin');
    });

    test('cargos novos entram com o perfil do Vendedor (SPEC, decisão 6), nunca de admin', () => {
        for (const cargo of ['diretor', 'gerente', 'coordenador', 'supervisor', 'analista', 'operador', 'auxiliar']) {
            expect(resolverCargo(cargo, null).role).toBe('vendedor');
            expect(resolverCargo(cargo, null).administrador).toBe(false);
        }
    });

    test('Diretor, Gerente e Coordenador veem custos; Supervisor, Analista e Vendedor não', () => {
        for (const cargo of ['diretor', 'gerente', 'coordenador']) {
            expect(resolverCargo(cargo, null).capacidades).toContain('ver_custos');
        }
        for (const cargo of ['supervisor', 'analista', 'vendedor', 'operador', 'auxiliar']) {
            expect(resolverCargo(cargo, null).capacidades).not.toContain('ver_custos');
        }
    });

    test('a escada de níveis padrão é estritamente decrescente do Admin ao Auxiliar', () => {
        const ordem = ['admin', 'diretor', 'gerente', 'coordenador', 'supervisor', 'analista', 'vendedor', 'operador', 'auxiliar'];
        const niveis = ordem.map((cargo) => resolverCargo(cargo, null).nivel);

        expect(niveis).toEqual([...niveis].sort((a, b) => b - a));
        expect(new Set(niveis).size).toBe(niveis.length);
    });

    test('Estoquista e Faturista ficam fora da escada (sem nível)', () => {
        expect(resolverCargo('estoquista', null)).toMatchObject({ nivel: null, escada: false });
        expect(resolverCargo('faturista', null)).toMatchObject({ nivel: null, escada: false, role: 'faturista', ativo: false });
    });

    test('cargo desconhecido não resolve (quem chama nega o acesso)', () => {
        expect(resolverCargo('presidente', null)).toBeNull();
        expect(resolverCargo(undefined, null)).toBeNull();
    });
});

describe('resolverCargo — linha do comércio é a verdade inteira do cargo', () => {
    test('liga um cargo e troca o nível: Supervisor acima de Coordenador neste comércio', () => {
        const supervisor = resolverCargo('supervisor', { nivel: 65, ativo: true, capacidades: ['cancelar_venda'] });
        const coordenador = resolverCargo('coordenador', { nivel: 60, ativo: true, capacidades: ['cancelar_venda'] });

        expect(supervisor.ativo).toBe(true);
        expect(supervisor.nivel).toBeGreaterThan(coordenador.nivel);
    });

    test('empate de nível é permitido (Analista com os mesmos acessos que Coordenador)', () => {
        const analista = resolverCargo('analista', { nivel: 60, ativo: true, capacidades: ['ver_custos'] });
        const coordenador = resolverCargo('coordenador', { nivel: 60, ativo: true, capacidades: ['ver_custos'] });

        expect(analista.nivel).toBe(coordenador.nivel);
        expect(analista.capacidades).toEqual(coordenador.capacidades);
    });

    test('lista vazia de capacidades vale como vazia (não volta ao padrão)', () => {
        expect(resolverCargo('gerente', { nivel: 70, ativo: true, capacidades: [] }).capacidades).toEqual([]);
    });

    test('cargo básico não desliga, mesmo com linha dizendo ativo = false', () => {
        expect(resolverCargo('vendedor', { nivel: 30, ativo: false, capacidades: [] }).ativo).toBe(true);
        expect(resolverCargo('estoquista', { nivel: null, ativo: false, capacidades: [] }).ativo).toBe(true);
    });

    test('cargo novo desligado pela linha fica inativo', () => {
        expect(resolverCargo('gerente', { nivel: 70, ativo: false, capacidades: [] }).ativo).toBe(false);
    });

    test('nível de cargo fora da escada é ignorado', () => {
        expect(resolverCargo('estoquista', { nivel: 50, ativo: true, capacidades: [] }).nivel).toBeNull();
    });

    test('a capacidade `administrador` num cargo vira perfil admin (privilégio de Admin anexado ao cargo)', () => {
        const gerente = resolverCargo('gerente', { nivel: 70, ativo: true, capacidades: ['administrador'] });

        expect(gerente).toMatchObject({ role: 'admin', administrador: true });
    });

    test('a linha não altera o catálogo em memória', () => {
        const antes = JSON.stringify(CATALOGO);

        resolverCargo('gerente', { nivel: 5, ativo: true, capacidades: ['x'] }).capacidades.push('y');
        resolverCargo('gerente', null).capacidades.push('z');

        expect(JSON.stringify(CATALOGO)).toBe(antes);
    });
});

describe('capacidades', () => {
    const usuario = (role, capacidades) => ({ role, capacidades });

    test('Admin tem todas, mesmo sem a lista', () => {
        expect(temCapacidade({ role: 'admin' }, 'ver_custos')).toBe(true);
        expect(podeVerCustos({ role: 'admin' })).toBe(true);
        expect(podeVerVendasDeTodos({ role: 'admin' })).toBe(true);
    });

    test('quem não tem a capacidade não passa, e usuário ausente nunca passa', () => {
        expect(temCapacidade(usuario('vendedor', ['cancelar_venda']), 'ver_custos')).toBe(false);
        expect(temCapacidade(usuario('vendedor', undefined), 'ver_custos')).toBe(false);
        expect(temCapacidade(null, 'ver_custos')).toBe(false);
        expect(podeVerCustosOperacionais(undefined)).toBe(false);
    });

    test('custo operacional: Admin, Estoquista e quem tem ver_custos; Vendedor e Faturista não', () => {
        expect(podeVerCustosOperacionais(usuario('admin', []))).toBe(true);
        expect(podeVerCustosOperacionais(usuario('estoquista', []))).toBe(true);
        expect(podeVerCustosOperacionais(usuario('vendedor', ['ver_custos']))).toBe(true);
        expect(podeVerCustosOperacionais(usuario('vendedor', []))).toBe(false);
        expect(podeVerCustosOperacionais(usuario('faturista', []))).toBe(false);
    });

    test('Estoquista não ganha custo analítico (só o operacional, como sempre foi)', () => {
        expect(podeVerCustos(usuario('estoquista', []))).toBe(false);
    });
});
