-- Tenant de demonstração "Vertumno Demo" (somente STAGING).
--
-- Cria uma empresa de demonstração completa e, se já houver uma, ARQUIVA a anterior antes
-- (restaurar = arquivar + recriar). Nada é apagado: o histórico imutável do sistema (cancelamentos,
-- comissões, trilha de usuários) impede DELETE, e a regra do projeto é não apagar histórico.
--
-- Uso (ver docs/TENANT_DEMO.md): substituir __SENHA_HASH__ por um hash bcrypt (nunca a senha) e
-- executar UMA vez, inteiro, no banco de STAGING. É uma única transação: ou tudo, ou nada.
--
-- NUNCA executar em produção: o script cria usuários com e-mail conhecido.

DO $demo$
DECLARE
    v_hash        CONSTANT text := '__SENHA_HASH__';
    v_nome        CONSTANT text := 'Vertumno Demo';
    v_slug        CONSTANT text := 'demo';
    v_antiga      record;
    v_empresa     int;
    v_canal       int;
    v_central     int;
    v_admin       int;
    v_vend        int;
    v_estq        int;
    v_clientes    int[];
    v_cid         int;
    v_prod        int[];
    v_custo       numeric[];
    v_preco       numeric[];
    v_saldo       int[];
    v_i           int;
    v_k           int;
    v_n           int;
    v_p           int;
    v_qtd         int;
    v_venda       int;
    v_total       numeric;
    v_forma       text;
    v_parcelas    int;
    v_dias        int;
    v_item2       boolean;
    v_custos_tab  numeric[] := ARRAY[20, 12, 18, 10, 35, 6, 48, 28, 9, 3.5, 22, 15];
    v_precos_tab  numeric[] := ARRAY[49.90, 29.90, 39.90, 24.90, 59.90, 5.00, 99.90, 69.90, 22.90, 8.90, 54.90, 34.90];
    v_nomes_tab   text[]    := ARRAY['Camiseta Básica', 'Caneca', 'Boné', 'Ecobag', 'Squeeze Térmico', 'Chaveiro Promo',
                                     'Mochila', 'Garrafa Inox', 'Caderno', 'Caneta', 'Necessaire', 'Chinelo'];
    v_skus_tab    text[]    := ARRAY['DEMO-001', 'DEMO-002', 'DEMO-003', 'DEMO-004', 'DEMO-005', 'DEMO-006',
                                     'DEMO-007', 'DEMO-008', 'DEMO-009', 'DEMO-010', 'DEMO-011', 'DEMO-012'];
    v_formas_tab  text[]    := ARRAY['pix', 'dinheiro', 'debito', 'credito'];
BEGIN
    IF v_hash NOT LIKE '$2%' THEN
        RAISE EXCEPTION 'Substitua __SENHA_HASH__ por um hash bcrypt antes de executar';
    END IF;

    -- 1) Arquiva a demonstração anterior (se houver): sai do ar, libera o endereço e os e-mails.
    FOR v_antiga IN SELECT id, slug FROM empresas WHERE slug = v_slug OR nome = v_nome LOOP
        UPDATE usuarios
           SET ativo = false,
               token_version = token_version + 1,
               email = 'arquivado-' || id || '-' || email
         WHERE empresa_id = v_antiga.id AND email NOT LIKE 'arquivado-%';

        UPDATE empresas
           SET status = 'inativa',
               slug = NULL,
               nome = v_nome || ' (arquivada #' || v_antiga.id || ')'
         WHERE id = v_antiga.id;

        IF v_antiga.slug IS NOT NULL THEN
            INSERT INTO empresas_identidade_eventos (empresa_id, tema_anterior, tema_novo, slug_anterior, slug_novo, responsavel)
            VALUES (v_antiga.id, 'vertumno', 'vertumno', v_antiga.slug, NULL, 'restaurar-demo.sql');
        END IF;
    END LOOP;

    -- 2) Empresa nova, com a identidade padrão do Vertumno e o endereço /c/demo.
    INSERT INTO empresas (nome, status, tema_visual, slug)
    VALUES (v_nome, 'ativa', 'vertumno', v_slug)
    RETURNING id INTO v_empresa;

    INSERT INTO empresas_identidade_eventos (empresa_id, tema_anterior, tema_novo, slug_anterior, slug_novo, responsavel)
    VALUES (v_empresa, 'vertumno', 'vertumno', NULL, v_slug, 'restaurar-demo.sql');

    -- 3) Mesmos padrões do onboarding.
    INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES (v_empresa, 'loja_fisica', true), (v_empresa, 'online', true);
    SELECT id INTO v_canal FROM canais_venda WHERE empresa_id = v_empresa AND nome = 'loja_fisica';

    INSERT INTO configuracoes_financeiras (empresa_id) VALUES (v_empresa);

    INSERT INTO configuracoes_sku (empresa_id, nome, tipo_sku, separador, prefixo, sufixo, tamanho_sequencia, inicio_sequencia, ativo)
    VALUES (v_empresa, 'Padrão', 'numerico', '-', '', '', 3, 1, true);

    INSERT INTO locais_estoque (empresa_id, tipo, nome) VALUES (v_empresa, 'central', 'Central')
    RETURNING id INTO v_central;

    -- 4) Equipe de demonstração (a senha é a mesma para os três).
    INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES (v_empresa, 'Demo Admin', 'admin@demo.example', v_hash, 'admin')
    RETURNING id INTO v_admin;
    INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES (v_empresa, 'Demo Vendedor', 'vendedor@demo.example', v_hash, 'vendedor')
    RETURNING id INTO v_vend;
    INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES (v_empresa, 'Demo Estoquista', 'estoquista@demo.example', v_hash, 'estoquista')
    RETURNING id INTO v_estq;

    -- 5) Clientes fictícios.
    v_clientes := ARRAY[]::int[];
    FOR v_i IN 1..6 LOOP
        INSERT INTO clientes (empresa_id, nome, telefone, email)
        VALUES (v_empresa,
                (ARRAY['Ana Demo', 'Bruno Demo', 'Carla Demo', 'Diego Demo', 'Elisa Demo', 'Fábio Demo'])[v_i],
                '1190000000' || v_i,
                'cliente' || v_i || '@demo.example')
        RETURNING id INTO v_cid;
        v_clientes := v_clientes || v_cid;
    END LOOP;

    -- 6) Produtos com estoque inicial no Central e preço no canal da loja.
    --    O Chaveiro Promo tem custo > preço de propósito (alerta de prejuízo nos relatórios).
    v_prod := ARRAY[]::int[];
    v_custo := v_custos_tab;
    v_preco := v_precos_tab;
    v_saldo := ARRAY[]::int[];
    FOR v_i IN 1..12 LOOP
        INSERT INTO produtos (empresa_id, sku, nome, preco_venda, custo, estoque_atual, estoque_minimo)
        VALUES (v_empresa, v_skus_tab[v_i], v_nomes_tab[v_i], v_precos_tab[v_i], v_custos_tab[v_i], 120, 10)
        RETURNING id INTO v_p;
        v_prod := v_prod || v_p;
        v_saldo := v_saldo || 120;

        INSERT INTO movimentacoes_estoque (empresa_id, produto_id, tipo, quantidade, estoque_resultante, motivo, usuario_id, local_id, saldo_local_resultante, origem)
        VALUES (v_empresa, v_p, 'entrada', 120, 120, 'Estoque inicial', v_admin, v_central, 120, 'estoque_inicial');

        INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, usuario_id)
        VALUES (v_empresa, v_p, v_canal, v_precos_tab[v_i],
                round(((v_precos_tab[v_i] - v_custos_tab[v_i]) / v_custos_tab[v_i]) * 100, 2),
                round(((v_precos_tab[v_i] - v_custos_tab[v_i]) / v_precos_tab[v_i]) * 100, 2),
                v_admin);
    END LOOP;

    -- 7) 24 vendas finalizadas nos últimos ~60 dias, com formas de pagamento variadas.
    --    Determinístico (sem random): a demonstração sai igual a cada restauração.
    FOR v_i IN 1..24 LOOP
        v_dias := 60 - (v_i * 5 / 2);
        v_forma := v_formas_tab[1 + (v_i % 4)];
        v_parcelas := CASE WHEN v_forma = 'credito' THEN 1 + (v_i % 3) ELSE 1 END;
        v_item2 := (v_i % 3 = 0);

        INSERT INTO vendas (empresa_id, cliente_id, canal_id, usuario_id, total, subtotal, status, data, forma_pagamento)
        VALUES (v_empresa, v_clientes[1 + (v_i % 6)], v_canal, CASE WHEN v_i % 2 = 0 THEN v_vend ELSE v_admin END,
                0, 0, 'finalizada', now() - make_interval(days => v_dias, hours => v_i % 9), 'a_vista')
        RETURNING id INTO v_venda;

        v_total := 0;
        FOR v_k IN 1..(CASE WHEN v_item2 THEN 2 ELSE 1 END) LOOP
            -- Nunca vende o Chaveiro Promo (índice 6): fica "parado" de propósito.
            v_n := 1 + ((v_i * 5 + v_k * 3) % 12);
            IF v_n = 6 THEN v_n := 7; END IF;
            v_qtd := 1 + ((v_i + v_k) % 3);

            INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario, custo_unitario, local_id)
            VALUES (v_empresa, v_venda, v_prod[v_n], v_qtd, v_preco[v_n], v_custo[v_n], v_central);

            v_saldo[v_n] := v_saldo[v_n] - v_qtd;
            v_total := v_total + v_qtd * v_preco[v_n];

            UPDATE produtos SET estoque_atual = v_saldo[v_n] WHERE id = v_prod[v_n];

            INSERT INTO movimentacoes_estoque (empresa_id, produto_id, tipo, quantidade, estoque_resultante, motivo, usuario_id, local_id, saldo_local_resultante)
            VALUES (v_empresa, v_prod[v_n], 'saida', v_qtd, v_saldo[v_n], 'Venda #' || v_venda, v_admin, v_central, v_saldo[v_n]);
        END LOOP;

        UPDATE vendas SET total = v_total, subtotal = v_total WHERE id = v_venda;

        INSERT INTO pagamentos_venda (venda_id, empresa_id, forma_pagamento, valor, valor_recebido, numero_parcelas, status, origem, usuario_id)
        VALUES (v_venda, v_empresa, v_forma, v_total, v_total, v_parcelas, 'pago', 'manual', v_admin);
    END LOOP;

    -- 8) Saldo final por produto no Central.
    FOR v_i IN 1..12 LOOP
        INSERT INTO estoque_locais (produto_id, local_id, empresa_id, saldo)
        VALUES (v_prod[v_i], v_central, v_empresa, v_saldo[v_i]);
    END LOOP;

    RAISE NOTICE 'Demo criada: empresa % (slug %), 3 usuários, 6 clientes, 12 produtos, 24 vendas.', v_empresa, v_slug;
END
$demo$;
