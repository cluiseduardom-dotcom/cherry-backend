const fs = require('node:fs');
const path = require('node:path');
const { listarMigrations } = require('../../src/database/migrate');

const SQL = fs.readFileSync(path.join(__dirname, '../../src/database/migrations/119_planos_lancamento_2026_11.sql'), 'utf8');
const EXECUTAVEL = SQL.replace(/--.*$/gm, '');

describe('migration 119 — planos de lançamento (nov/2026)', () => {
    test('está no runner', async () => {
        expect((await listarMigrations()).map((m) => m.versao)).toContain(119);
    });

    test('limites 1, 4 e sem limite, só a partir do valor original (não sobrescreve ajuste posterior)', () => {
        expect(EXECUTAVEL).toMatch(/SET limite_usuarios = 1\s+WHERE codigo = 'basico' AND limite_usuarios = 5;/);
        expect(EXECUTAVEL).toMatch(/SET limite_usuarios = 4\s+WHERE codigo = 'padrao' AND limite_usuarios = 7;/);
        expect(EXECUTAVEL).toMatch(/SET limite_usuarios = NULL WHERE codigo = 'pro'\s+AND limite_usuarios = 15;/);
        expect(EXECUTAVEL).not.toMatch(/cortesia|sem_mensalidade|com_mensalidade/i);
    });

    test('Fiado e Importação entram nos três planos, de forma idempotente, e nada é apagado', () => {
        expect(EXECUTAVEL).toMatch(/INSERT INTO plano_funcionalidades/);
        expect(EXECUTAVEL).toMatch(/p\.codigo IN \('basico', 'padrao', 'pro'\)/);
        expect(EXECUTAVEL).toMatch(/f\.codigo IN \('fiado', 'importacao_lista'\)/);
        expect(EXECUTAVEL).toMatch(/ON CONFLICT \(plano_id, funcionalidade\) DO NOTHING/);
        expect(EXECUTAVEL).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|DROP)\b/i);
        expect(EXECUTAVEL).not.toMatch(/loja_online/);
    });

    test('tem o roteiro de reversão manual no rodapé', () => {
        expect(SQL).toMatch(/Reversão manual[\s\S]*limite_usuarios = 5[\s\S]*limite_usuarios = 7[\s\S]*limite_usuarios = 15/);
        expect(SQL).toMatch(/DELETE FROM plano_funcionalidades WHERE funcionalidade IN \('fiado', 'importacao_lista'\)/);
    });
});
