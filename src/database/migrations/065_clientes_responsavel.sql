-- Clientes por usuário: quem cadastrou o cliente é o responsável por ele.
--
-- clientes.criado_por: usuário que cadastrou. NULL = cliente anterior a esta migration (legado, sem dono).
-- Regra (aplicada no backend): quem tem a capacidade `ver_todos_clientes` (Admin, Diretor, Gerente,
-- Coordenador, Supervisor, Analista e Analista financeiro, por padrão) vê todos os clientes da empresa; os
-- demais (Vendedor, Operador, Auxiliar) veem só os que cadastraram. Cliente legado só é visto por quem vê todos.
-- FK composta (criado_por, empresa_id): o responsável é sempre da mesma empresa. Migration só aditiva.

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS criado_por INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clientes_criado_por_empresa_fk') THEN
        ALTER TABLE clientes
            ADD CONSTRAINT clientes_criado_por_empresa_fk
            FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clientes_empresa_criado_por ON clientes (empresa_id, criado_por);

-- Empresas que já editaram esses cargos (cargos_empresa com capacidades EXPLÍCITAS) não recebem o novo
-- padrão do catálogo. Hoje todos veem todos os clientes; para não mudar o que esses cargos já veem,
-- eles recebem `ver_todos_clientes`. Vendedor, Operador e Auxiliar ficam de fora (a regra nova).
-- Idempotente.
UPDATE cargos_empresa
   SET capacidades = array_append(capacidades, 'ver_todos_clientes'),
       atualizado_em = NOW()
 WHERE cargo IN ('diretor', 'gerente', 'coordenador', 'supervisor', 'analista', 'financeiro')
   AND NOT ('ver_todos_clientes' = ANY(capacidades));

-- Reversão manual: ALTER TABLE clientes DROP COLUMN criado_por;
--                  UPDATE cargos_empresa SET capacidades = array_remove(capacidades, 'ver_todos_clientes');
