const {
    criarRegistroDeEmpresas,
    removerEmpresaDeTeste,
    removerEmpresasPorNome,
} = require('../helpers/limpezaEmpresasTeste');

// Banco FALSO: grava cada comando recebido e simula empresas, tabelas e violações de FK.
// Nada abre conexão real.
function criarBancoFalso({ empresas = {}, tabelas = [], falhasDeFk = {}, erroEm = null } = {}) {
    const comandos = [];
    const tentativasPorTabela = {};
    const state = { liberados: 0, bloqueioSimultaneo: 0 };

    const cliente = {
        query: jest.fn(async (sql, params = []) => {
            comandos.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });

            if (/FROM empresas WHERE id = \$1/.test(sql) && /^\s*SELECT nome/.test(sql)) {
                const nome = empresas[params[0]];
                return { rows: nome === undefined ? [] : [{ nome }] };
            }

            if (/FROM information_schema\.columns/.test(sql)) {
                return { rows: tabelas.map((t) => ({ table_name: t })) };
            }

            const m = sql.match(/^DELETE FROM "([^"]+)" WHERE empresa_id/);
            if (m) {
                const tabela = m[1];
                tentativasPorTabela[tabela] = (tentativasPorTabela[tabela] || 0) + 1;

                if (erroEm === tabela) {
                    throw Object.assign(new Error('falha de infraestrutura'), { code: '08006' });
                }

                if (tentativasPorTabela[tabela] <= (falhasDeFk[tabela] || 0)) {
                    throw Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
                }
            }

            return { rows: [] };
        }),
        release: jest.fn(() => {
            state.liberados += 1;
        }),
    };

    const db = {
        connect: jest.fn(async () => cliente),
        query: jest.fn(async (sql, params) => {
            comandos.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            if (/FROM empresas WHERE nome LIKE/.test(sql)) {
                const like = new RegExp('^' + params[0].replace(/%/g, '.*') + '$');
                return { rows: Object.entries(empresas).filter(([, nome]) => like.test(nome)).map(([id]) => ({ id: Number(id) })) };
            }
            return { rows: [] };
        }),
    };

    const sqls = () => comandos.map((c) => c.sql);

    return { db, cliente, comandos, sqls, state };
}

describe('removerEmpresaDeTeste', () => {
    test('remove as tabelas da empresa e depois a empresa, dentro de UMA transação', async () => {
        const { db, cliente, sqls } = criarBancoFalso({ empresas: { 88: 'Teste Taxa Plataforma A 1234' }, tabelas: ['produtos', 'usuarios'] });

        const r = await removerEmpresaDeTeste(db, 88);

        expect(r).toEqual({ removida: true });

        const s = sqls();
        expect(s.indexOf('BEGIN')).toBeLessThan(s.indexOf('DELETE FROM "produtos" WHERE empresa_id = $1'));
        expect(s.indexOf('DELETE FROM "usuarios" WHERE empresa_id = $1')).toBeLessThan(s.indexOf('DELETE FROM empresas WHERE id = $1'));
        expect(s[s.length - 1]).toBe('COMMIT');
        expect(s).not.toContain('ROLLBACK');
        expect(cliente.release).toHaveBeenCalledTimes(1);
    });

    test('todos os DELETE são filtrados pelo id da empresa registrada', async () => {
        const { db, comandos } = criarBancoFalso({ empresas: { 88: 'Teste X' }, tabelas: ['produtos', 'vendas'] });

        await removerEmpresaDeTeste(db, 88);

        const deletes = comandos.filter((c) => /^DELETE/.test(c.sql));
        expect(deletes.length).toBe(3);
        for (const d of deletes) expect(d.params).toEqual([88]);
        expect(deletes.every((d) => /WHERE (empresa_id|id) = \$1$/.test(d.sql))).toBe(true);
    });

    test('empresa que não existe: não faz nada (nem abre transação)', async () => {
        const { db, sqls, cliente } = criarBancoFalso({ empresas: {}, tabelas: ['produtos'] });

        expect(await removerEmpresaDeTeste(db, 999)).toEqual({ removida: false });
        expect(sqls().some((s) => /^(BEGIN|DELETE)/.test(s))).toBe(false);
        expect(cliente.release).toHaveBeenCalledTimes(1);
    });

    test.each(['Cherry Semijoias', 'Empresa Real Ltda', 'Testemunho S/A', 'Contesto'])(
        'RECUSA apagar empresa sem nome de teste (%s): nenhum DELETE, nenhuma transação',
        async (nome) => {
            const { db, sqls, cliente } = criarBancoFalso({ empresas: { 1: nome }, tabelas: ['produtos'] });

            await expect(removerEmpresaDeTeste(db, 1)).rejects.toThrow(/não tem nome de empresa de teste/);

            expect(sqls().some((s) => /^(BEGIN|DELETE|COMMIT)/.test(s))).toBe(false);
            expect(cliente.release).toHaveBeenCalledTimes(1);
        }
    );

    test.each([undefined, null, 'abc', 0, -3, 1.5])('id inválido (%p) é rejeitado antes de qualquer comando', async (id) => {
        const { db } = criarBancoFalso();

        await expect(removerEmpresaDeTeste(db, id)).rejects.toThrow(/empresaId inválido/);
        expect(db.connect).not.toHaveBeenCalled();
    });

    test('ordem das FKs: o que falha por FK (23503) é repetido depois que os filhos saíram', async () => {
        const { db, sqls } = criarBancoFalso({
            empresas: { 88: 'Teste Y' },
            tabelas: ['pai', 'filho'],
            falhasDeFk: { pai: 1 }, // "pai" só pode sair depois de "filho"
        });

        await removerEmpresaDeTeste(db, 88);

        const deletes = sqls().filter((s) => s.startsWith('DELETE FROM "'));
        expect(deletes).toEqual([
            'DELETE FROM "pai" WHERE empresa_id = $1', // falhou (FK)
            'DELETE FROM "filho" WHERE empresa_id = $1',
            'DELETE FROM "pai" WHERE empresa_id = $1', // repetido e passou
        ]);
        expect(sqls()).toContain('ROLLBACK TO SAVEPOINT limpeza_tabela');
        expect(sqls()[sqls().length - 1]).toBe('COMMIT');
    });

    test('FK que nunca se resolve: desfaz tudo (ROLLBACK), não apaga a empresa e informa a tabela travada', async () => {
        const { db, sqls, cliente } = criarBancoFalso({
            empresas: { 88: 'Teste Z' },
            tabelas: ['travada'],
            falhasDeFk: { travada: 99 },
        });

        await expect(removerEmpresaDeTeste(db, 88)).rejects.toThrow(/travada por chave estrangeira em: travada/);

        expect(sqls()).toContain('ROLLBACK');
        expect(sqls()).not.toContain('COMMIT');
        expect(sqls()).not.toContain('DELETE FROM empresas WHERE id = $1');
        expect(cliente.release).toHaveBeenCalledTimes(1);
    });

    test('erro que não é de FK interrompe com ROLLBACK e propaga', async () => {
        const { db, sqls, cliente } = criarBancoFalso({ empresas: { 88: 'Teste W' }, tabelas: ['a', 'b'], erroEm: 'a' });

        await expect(removerEmpresaDeTeste(db, 88)).rejects.toThrow(/falha de infraestrutura/);

        expect(sqls()).toContain('ROLLBACK');
        expect(sqls()).not.toContain('COMMIT');
        expect(cliente.release).toHaveBeenCalledTimes(1);
    });
});

describe('registro de empresas: falha DURANTE a preparação ainda limpa', () => {
    test('empresa registrada logo após o INSERT é removida mesmo quando a preparação lança erro depois', async () => {
        const { db, sqls } = criarBancoFalso({ empresas: { 88: 'Teste Taxa Plataforma A abcd' }, tabelas: ['canais_venda', 'produtos', 'usuarios'] });
        const registro = criarRegistroDeEmpresas(db);

        // Reproduz a falha que deixou resíduos: INSERT da empresa ok, depois o login/produto falha.
        async function preparacao() {
            registro.registrar(88); // logo após o INSERT
            throw new Error('preço Barato A: 400'); // falha no meio da preparação
        }

        await expect(preparacao()).rejects.toThrow(/preço Barato A/);
        expect(registro.ids()).toEqual([88]);

        await registro.limpar(); // o afterAll

        const s = sqls();
        expect(s).toContain('DELETE FROM "usuarios" WHERE empresa_id = $1');
        expect(s).toContain('DELETE FROM "produtos" WHERE empresa_id = $1');
        expect(s).toContain('DELETE FROM empresas WHERE id = $1');
        expect(s[s.length - 1]).toBe('COMMIT');
        expect(registro.ids()).toEqual([]);
    });

    test('sem registrar (o padrão antigo), nada seria limpo: o registro precoce é o que protege', async () => {
        const { db, sqls } = criarBancoFalso({ empresas: { 88: 'Teste Taxa Plataforma A abcd' }, tabelas: ['produtos'] });
        const registro = criarRegistroDeEmpresas(db);

        // padrão antigo: o id só era guardado no FIM da preparação (que lançou antes disso)
        await registro.limpar();

        expect(sqls().some((s) => /^DELETE/.test(s))).toBe(false);
    });

    test('várias empresas: limpa todas (da última para a primeira) e continua mesmo se uma falhar', async () => {
        const { db, sqls } = criarBancoFalso({
            empresas: { 10: 'Teste 10', 11: 'Cherry Semijoias', 12: 'Teste 12' },
            tabelas: ['produtos'],
        });
        const registro = criarRegistroDeEmpresas(db);
        registro.registrar(10);
        registro.registrar(11); // registrada por engano: será recusada
        registro.registrar(12);

        await expect(registro.limpar()).rejects.toThrow(/falha ao limpar empresas de teste/);

        const apagadas = sqls().filter((s) => s === 'DELETE FROM empresas WHERE id = $1').length;
        expect(apagadas).toBe(2); // 12 e 10 foram removidas, 11 (real) foi preservada
        expect(registro.ids()).toEqual([]);
    });

    test('a empresa real nunca é apagada, mesmo que alguém a registre', async () => {
        const { db, comandos } = criarBancoFalso({ empresas: { 1: 'Cherry Semijoias' }, tabelas: ['produtos', 'usuarios'] });
        const registro = criarRegistroDeEmpresas(db);
        registro.registrar(1);

        await expect(registro.limpar()).rejects.toBeInstanceOf(AggregateError);

        expect(comandos.some((c) => /^DELETE/.test(c.sql))).toBe(false);
    });
});

describe('removerEmpresasPorNome (rede de segurança)', () => {
    test('remove só empresas de teste que casam com o padrão da execução', async () => {
        const { db, sqls } = criarBancoFalso({
            empresas: { 5: 'Teste Taxa Plataforma A f00d', 6: 'Teste Taxa Plataforma B f00d', 7: 'Teste Taxa Plataforma A outro' },
            tabelas: ['produtos'],
        });

        const n = await removerEmpresasPorNome(db, 'Teste Taxa Plataforma % f00d');

        expect(n).toBe(2);
        expect(sqls().filter((s) => s === 'DELETE FROM empresas WHERE id = $1').length).toBe(2);
    });

    test('a consulta exige prefixo de teste além do padrão, protegendo empresas reais', async () => {
        const { db, comandos } = criarBancoFalso({ empresas: {}, tabelas: [] });

        await removerEmpresasPorNome(db, '%');

        const consulta = comandos.find((c) => /FROM empresas WHERE nome LIKE/.test(c.sql));
        expect(consulta.sql).toMatch(/nome LIKE 'Teste%' OR nome LIKE 'Empresa Teste%'/);
    });
});
