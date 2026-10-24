-- Blindagem das tabelas de comissão criadas na 054 (migration corretiva; a 054 já foi mergeada).
--
-- 1) comissoes_eventos passa a ser imutável NO BANCO (UPDATE/DELETE recusados), no mesmo padrão
--    de usuarios_eventos (055) e cancelamentos_venda (052). A exceção é a limpeza de empresas
--    descartáveis dos testes, que liga vertumno.limpeza_teste dentro da própria transação.
--    comissao_repasses NÃO é imutável: o status muda (a_repassar -> confirmado/cancelado).
-- 2) Referências entre recursos passam a ser compostas (id, empresa_id): o banco recusa uma
--    linha de comissão que aponte para venda, usuário, pagamento ou repasse de OUTRA empresa,
--    em vez de depender só da aplicação filtrar por empresa_id.
--
-- Idempotente. As FKs entram NOT VALID (valem para toda linha nova) e depois tentam validar o
-- legado; se existir linha antiga inconsistente, a migration não derruba o deploy: emite um
-- WARNING e a constraint segue valendo só para linhas novas.

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendas_id_empresa ON vendas (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pagamentos_venda_id_empresa ON pagamentos_venda (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_comissoes_venda_id_empresa ON comissoes_venda (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_comissao_repasses_id_empresa ON comissao_repasses (id, empresa_id);
-- uq_usuarios_id_empresa já existe (055); repetido aqui para a 056 não depender da ordem de leitura.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_id_empresa ON usuarios (id, empresa_id);

DO $$
DECLARE
    fk RECORD;
BEGIN
    FOR fk IN
        SELECT * FROM (VALUES
            ('comissoes_venda',   'comissoes_venda_venda_empresa_fk',      'venda_id',      'vendas'),
            ('comissoes_venda',   'comissoes_venda_usuario_empresa_fk',    'usuario_id',    'usuarios'),
            ('comissoes_eventos', 'comissoes_eventos_comissao_empresa_fk', 'comissao_id',   'comissoes_venda'),
            ('comissoes_eventos', 'comissoes_eventos_venda_empresa_fk',    'venda_id',      'vendas'),
            ('comissoes_eventos', 'comissoes_eventos_repasse_empresa_fk',  'repasse_id',    'comissao_repasses'),
            ('comissoes_eventos', 'comissoes_eventos_executor_empresa_fk', 'executado_por', 'usuarios'),
            ('comissao_repasses', 'comissao_repasses_pagamento_empresa_fk', 'pagamento_id', 'pagamentos_venda'),
            ('comissao_repasses', 'comissao_repasses_venda_empresa_fk',    'venda_id',     'vendas'),
            ('comissao_repasses', 'comissao_repasses_vendedor_empresa_fk',  'vendedor_id',  'usuarios'),
            ('comissao_repasses', 'comissao_repasses_confirmador_empresa_fk', 'confirmado_por', 'usuarios')
        ) AS t(tabela, nome, coluna, pai)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, empresa_id) REFERENCES %I (id, empresa_id) NOT VALID',
                fk.tabela, fk.nome, fk.coluna, fk.pai
            );
        END IF;

        BEGIN
            EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.tabela, fk.nome);
        EXCEPTION WHEN foreign_key_violation THEN
            RAISE WARNING 'Constraint % não validada: há linhas antigas de % com referência de outra empresa; vale só para linhas novas.', fk.nome, fk.tabela;
        END;
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION comissoes_eventos_imutavel() RETURNS trigger AS $$
BEGIN
    IF current_setting('vertumno.limpeza_teste', true) = 'on' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'comissoes_eventos é imutável (% recusado)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comissoes_eventos_imutavel ON comissoes_eventos;
CREATE TRIGGER trg_comissoes_eventos_imutavel
    BEFORE UPDATE OR DELETE ON comissoes_eventos
    FOR EACH ROW EXECUTE FUNCTION comissoes_eventos_imutavel();

-- Reversão manual (não executada pelo runner):
--   DROP TRIGGER IF EXISTS trg_comissoes_eventos_imutavel ON comissoes_eventos;
--   DROP FUNCTION IF EXISTS comissoes_eventos_imutavel();
--   ALTER TABLE comissoes_venda DROP CONSTRAINT IF EXISTS comissoes_venda_venda_empresa_fk, ... (demais *_empresa_fk acima);
