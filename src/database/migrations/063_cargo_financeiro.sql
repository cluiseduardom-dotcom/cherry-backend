-- Cargo funcional "financeiro" (Analista financeiro) e capacidade gerir_financeiro.
-- Corretiva: não altera migrations já aplicadas (050 define as constraints de cargo).

DO $$
DECLARE
    restricao TEXT;
BEGIN
    FOR restricao IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'usuarios'::regclass AND contype = 'c' AND conname = 'usuarios_papel_chk'
    LOOP
        EXECUTE format('ALTER TABLE usuarios DROP CONSTRAINT %I', restricao);
    END LOOP;

    ALTER TABLE usuarios
        ADD CONSTRAINT usuarios_papel_chk CHECK (papel IN (
            'admin', 'diretor', 'gerente', 'coordenador', 'supervisor', 'analista',
            'vendedor', 'operador', 'auxiliar', 'estoquista', 'faturista', 'financeiro'
        ));

    ALTER TABLE cargos_empresa DROP CONSTRAINT IF EXISTS cargos_empresa_cargo_chk;
    ALTER TABLE cargos_empresa
        ADD CONSTRAINT cargos_empresa_cargo_chk CHECK (cargo IN (
            'diretor', 'gerente', 'coordenador', 'supervisor', 'analista',
            'vendedor', 'operador', 'auxiliar', 'estoquista', 'faturista', 'financeiro'
        ));
END $$;

-- Empresas que já editaram Diretor/Gerente têm linha em cargos_empresa com capacidades EXPLÍCITAS,
-- então o novo padrão do catálogo não as alcança. Para não tirar de ninguém o que já fazia (quem
-- tem ver_vendas_de_todos confirma repasse hoje), Diretor/Gerente configurados que ainda têm
-- ver_vendas_de_todos recebem gerir_financeiro. Coordenador e Supervisor NÃO recebem (decisão do
-- Product Owner: financeiro fica com Financeiro, Diretor, Gerente e Admin). Idempotente.
UPDATE cargos_empresa
   SET capacidades = array_append(capacidades, 'gerir_financeiro'),
       atualizado_em = NOW()
 WHERE cargo IN ('diretor', 'gerente')
   AND 'ver_vendas_de_todos' = ANY(capacidades)
   AND NOT ('gerir_financeiro' = ANY(capacidades));

-- Reversão manual (só se nenhum usuário usar o cargo):
--   UPDATE cargos_empresa SET capacidades = array_remove(capacidades, 'gerir_financeiro');
--   (recriar usuarios_papel_chk e cargos_empresa_cargo_chk sem 'financeiro')
