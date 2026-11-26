-- Tarefa 01 (auditoria multi-tenant), PR 3: o banco passa a recusar referência entre empresas.
--
-- Hoje só 37 colunas têm FK composta (id, empresa_id); as demais (100 colunas filhas) apontam só para o id,
-- então o isolamento depende exclusivamente de a aplicação filtrar por empresa_id. Esta migration (aditiva,
-- no padrão da 056) acrescenta, sem remover nada:
--   1) UNIQUE (id, empresa_id) nas 24 tabelas-pai que ainda não têm (necessário para a FK composta;
--      trivialmente única, porque id já é chave primária);
--   2) FK composta (coluna, empresa_id) -> pai (id, empresa_id) para 100 colunas, preservando o ON DELETE
--      da FK simples existente. A FK simples original continua no lugar.
--
-- Idempotente. As FKs entram NOT VALID (valem para toda linha nova ou alterada) e depois tentam validar o
-- legado; se existir linha antiga inconsistente, a migration NÃO derruba o deploy: emite um WARNING e a
-- constraint segue valendo só para linhas novas. Coluna nula não é verificada (MATCH SIMPLE).
-- Nenhum dado é alterado ou removido.

CREATE UNIQUE INDEX IF NOT EXISTS uq_canais_venda_id_empresa ON canais_venda (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_produto_id_empresa ON categorias_produto (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_centros_custo_id_empresa ON centros_custo (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_id_empresa ON compras (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_configuracoes_sku_id_empresa ON configuracoes_sku (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_bancarias_id_empresa ON contas_bancarias (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotacoes_id_empresa ON cotacoes (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotacoes_fornecedores_id_empresa ON cotacoes_fornecedores (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cotacoes_itens_id_empresa ON cotacoes_itens (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiado_lancamentos_id_empresa ON fiado_lancamentos (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fichas_tecnicas_id_empresa ON fichas_tecnicas (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fornecedores_id_empresa ON fornecedores (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_itens_venda_id_empresa ON itens_venda (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_liquidacoes_pagamento_id_empresa ON liquidacoes_pagamento (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_movimentos_bancarios_id_empresa ON movimentos_bancarios (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ordens_compra_id_empresa ON ordens_compra (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ordens_compra_itens_id_empresa ON ordens_compra_itens (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parcelas_pagamento_id_empresa ON parcelas_pagamento (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_compra_id_empresa ON pedidos_compra (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_compra_itens_id_empresa ON pedidos_compra_itens (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projetos_id_empresa ON projetos (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recebimentos_id_empresa ON recebimentos (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transacoes_pagamento_id_empresa ON transacoes_pagamento (id, empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transacoes_pagamento_parcelas_id_empresa ON transacoes_pagamento_parcelas (id, empresa_id);

DO $$
DECLARE
    fk RECORD;
BEGIN
    FOR fk IN
        SELECT * FROM (VALUES
            ('cancelamentos_venda', 'cancelamentos_venda_autorizado_por_empresa_fk', 'autorizado_por', 'usuarios', 'NO ACTION'),
            ('cancelamentos_venda', 'cancelamentos_venda_cancelado_por_empresa_fk', 'cancelado_por', 'usuarios', 'NO ACTION'),
            ('cancelamentos_venda', 'cancelamentos_venda_venda_id_empresa_fk', 'venda_id', 'vendas', 'NO ACTION'),
            ('cargos_empresa', 'cargos_empresa_atualizado_por_empresa_fk', 'atualizado_por', 'usuarios', 'NO ACTION'),
            ('categorias_produto', 'categorias_produto_configuracao_sku_id_empresa_fk', 'configuracao_sku_id', 'configuracoes_sku', 'NO ACTION'),
            ('centros_custo', 'centros_custo_centro_custo_pai_id_empresa_fk', 'centro_custo_pai_id', 'centros_custo', 'NO ACTION'),
            ('clientes', 'clientes_importacao_id_empresa_fk', 'importacao_id', 'importacoes', 'NO ACTION'),
            ('cobrancas_pagamento', 'cobrancas_pagamento_criado_por_empresa_fk', 'criado_por', 'usuarios', 'NO ACTION'),
            ('cobrancas_pagamento', 'cobrancas_pagamento_venda_id_empresa_fk', 'venda_id', 'vendas', 'NO ACTION'),
            ('comissao_percentuais', 'comissao_percentuais_atualizado_por_empresa_fk', 'atualizado_por', 'usuarios', 'NO ACTION'),
            ('comissao_percentuais', 'comissao_percentuais_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('compras', 'compras_fornecedor_id_empresa_fk', 'fornecedor_id', 'fornecedores', 'NO ACTION'),
            ('conciliacoes_bancarias', 'conciliacoes_bancarias_movimento_bancario_id_empresa_fk', 'movimento_bancario_id', 'movimentos_bancarios', 'NO ACTION'),
            ('conciliacoes_bancarias', 'conciliacoes_bancarias_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('condicoes_comerciais_empresa', 'condicoes_comerciais_empresa_substitui_id_empresa_fk', 'substitui_id', 'condicoes_comerciais_empresa', 'NO ACTION'),
            ('contas_bancarias', 'contas_bancarias_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('contas_pagar', 'contas_pagar_centro_custo_id_empresa_fk', 'centro_custo_id', 'centros_custo', 'NO ACTION'),
            ('contas_pagar', 'contas_pagar_compra_id_empresa_fk', 'compra_id', 'compras', 'NO ACTION'),
            ('contas_pagar', 'contas_pagar_projeto_id_empresa_fk', 'projeto_id', 'projetos', 'NO ACTION'),
            ('contas_pagar', 'contas_pagar_recebimento_id_empresa_fk', 'recebimento_id', 'recebimentos', 'NO ACTION'),
            ('contas_pagar', 'contas_pagar_transacao_pagamento_id_empresa_fk', 'transacao_pagamento_id', 'transacoes_pagamento', 'NO ACTION'),
            ('contas_pagar', 'contas_pagar_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('contas_receber', 'contas_receber_centro_custo_id_empresa_fk', 'centro_custo_id', 'centros_custo', 'NO ACTION'),
            ('contas_receber', 'contas_receber_parcela_id_empresa_fk', 'parcela_id', 'parcelas_pagamento', 'NO ACTION'),
            ('contas_receber', 'contas_receber_projeto_id_empresa_fk', 'projeto_id', 'projetos', 'NO ACTION'),
            ('contas_receber', 'contas_receber_venda_id_empresa_fk', 'venda_id', 'vendas', 'NO ACTION'),
            ('cotacoes_fornecedores_itens', 'cotacoes_fornecedores_itens_cotacao_fornecedor_id_empresa_fk', 'cotacao_fornecedor_id', 'cotacoes_fornecedores', 'NO ACTION'),
            ('cotacoes_fornecedores_itens', 'cotacoes_fornecedores_itens_cotacao_item_id_empresa_fk', 'cotacao_item_id', 'cotacoes_itens', 'NO ACTION'),
            ('cotacoes_fornecedores', 'cotacoes_fornecedores_cotacao_id_empresa_fk', 'cotacao_id', 'cotacoes', 'NO ACTION'),
            ('cotacoes_itens', 'cotacoes_itens_cotacao_id_empresa_fk', 'cotacao_id', 'cotacoes', 'NO ACTION'),
            ('despesas_fixas', 'despesas_fixas_centro_custo_id_empresa_fk', 'centro_custo_id', 'centros_custo', 'NO ACTION'),
            ('despesas_fixas', 'despesas_fixas_projeto_id_empresa_fk', 'projeto_id', 'projetos', 'NO ACTION'),
            ('empresa_mercadopago', 'empresa_mercadopago_conectado_por_empresa_fk', 'conectado_por', 'usuarios', 'NO ACTION'),
            ('estornos_pagamento', 'estornos_pagamento_pagamento_id_empresa_fk', 'pagamento_id', 'pagamentos_venda', 'NO ACTION'),
            ('estornos_pagamento', 'estornos_pagamento_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('fiado_lancamentos', 'fiado_lancamentos_estorna_id_empresa_fk', 'estorna_id', 'fiado_lancamentos', 'NO ACTION'),
            ('fichas_tecnicas', 'fichas_tecnicas_criado_por_empresa_fk', 'criado_por', 'usuarios', 'NO ACTION'),
            ('fichas_tecnicas', 'fichas_tecnicas_produto_id_empresa_fk', 'produto_id', 'produtos', 'NO ACTION'),
            ('historico_sku', 'historico_sku_configuracao_id_empresa_fk', 'configuracao_id', 'configuracoes_sku', 'NO ACTION'),
            ('historico_sku', 'historico_sku_produto_id_empresa_fk', 'produto_id', 'produtos', 'NO ACTION'),
            ('historico_sku', 'historico_sku_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('idempotency_keys', 'idempotency_keys_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('importacoes', 'importacoes_confirmada_por_empresa_fk', 'confirmada_por', 'usuarios', 'NO ACTION'),
            ('itens_compra', 'itens_compra_compra_id_empresa_fk', 'compra_id', 'compras', 'NO ACTION'),
            ('itens_compra', 'itens_compra_produto_id_empresa_fk', 'produto_id', 'produtos', 'NO ACTION'),
            ('itens_ficha_tecnica', 'itens_ficha_tecnica_ficha_tecnica_id_empresa_fk', 'ficha_tecnica_id', 'fichas_tecnicas', 'NO ACTION'),
            ('itens_ficha_tecnica', 'itens_ficha_tecnica_insumo_produto_id_empresa_fk', 'insumo_produto_id', 'produtos', 'NO ACTION'),
            ('itens_venda', 'itens_venda_produto_id_empresa_fk', 'produto_id', 'produtos', 'NO ACTION'),
            ('itens_venda', 'itens_venda_venda_id_empresa_fk', 'venda_id', 'vendas', 'CASCADE'),
            ('liquidacoes_pagamento', 'liquidacoes_pagamento_transacao_pagamento_id_empresa_fk', 'transacao_pagamento_id', 'transacoes_pagamento', 'NO ACTION'),
            ('liquidacoes_pagamento', 'liquidacoes_pagamento_transacao_pagamento_parcela_id_empresa_fk', 'transacao_pagamento_parcela_id', 'transacoes_pagamento_parcelas', 'NO ACTION'),
            ('liquidacoes_pagamento', 'liquidacoes_pagamento_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('movimentacoes_estoque', 'movimentacoes_estoque_compra_id_empresa_fk', 'compra_id', 'compras', 'NO ACTION'),
            ('movimentacoes_estoque', 'movimentacoes_estoque_produto_id_empresa_fk', 'produto_id', 'produtos', 'NO ACTION'),
            ('movimentacoes_estoque', 'movimentacoes_estoque_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('movimentos_bancarios', 'movimentos_bancarios_cancelado_por_empresa_fk', 'cancelado_por', 'usuarios', 'NO ACTION'),
            ('movimentos_bancarios', 'movimentos_bancarios_conta_bancaria_id_empresa_fk', 'conta_bancaria_id', 'contas_bancarias', 'NO ACTION'),
            ('movimentos_bancarios', 'movimentos_bancarios_liquidacao_pagamento_id_empresa_fk', 'liquidacao_pagamento_id', 'liquidacoes_pagamento', 'NO ACTION'),
            ('movimentos_bancarios', 'movimentos_bancarios_transacao_pagamento_id_empresa_fk', 'transacao_pagamento_id', 'transacoes_pagamento', 'NO ACTION'),
            ('movimentos_bancarios', 'movimentos_bancarios_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('mp_oauth_estados', 'mp_oauth_estados_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('oc_pc_itens', 'oc_pc_itens_ordem_compra_item_id_empresa_fk', 'ordem_compra_item_id', 'ordens_compra_itens', 'NO ACTION'),
            ('oc_pc_itens', 'oc_pc_itens_pedido_compra_item_id_empresa_fk', 'pedido_compra_item_id', 'pedidos_compra_itens', 'NO ACTION'),
            ('ordens_compra_itens', 'ordens_compra_itens_ordem_compra_id_empresa_fk', 'ordem_compra_id', 'ordens_compra', 'NO ACTION'),
            ('ordens_producao', 'ordens_producao_ficha_tecnica_id_empresa_fk', 'ficha_tecnica_id', 'fichas_tecnicas', 'NO ACTION'),
            ('pagamentos_venda', 'pagamentos_venda_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('pagamentos_venda', 'pagamentos_venda_venda_id_empresa_fk', 'venda_id', 'vendas', 'NO ACTION'),
            ('parcelas_pagamento', 'parcelas_pagamento_pagamento_id_empresa_fk', 'pagamento_id', 'pagamentos_venda', 'NO ACTION'),
            ('parcelas_pagamento', 'parcelas_pagamento_usuario_baixa_id_empresa_fk', 'usuario_baixa_id', 'usuarios', 'NO ACTION'),
            ('pedidos_compra_itens', 'pedidos_compra_itens_pedido_compra_id_empresa_fk', 'pedido_compra_id', 'pedidos_compra', 'NO ACTION'),
            ('pedidos_loja', 'pedidos_loja_venda_id_empresa_fk', 'venda_id', 'vendas', 'NO ACTION'),
            ('precos_produto', 'precos_produto_canal_id_empresa_fk', 'canal_id', 'canais_venda', 'NO ACTION'),
            ('precos_produto', 'precos_produto_produto_id_empresa_fk', 'produto_id', 'produtos', 'NO ACTION'),
            ('precos_produto', 'precos_produto_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('privilegios_eventos', 'privilegios_eventos_alvo_usuario_id_empresa_fk', 'alvo_usuario_id', 'usuarios', 'NO ACTION'),
            ('privilegios_eventos', 'privilegios_eventos_executado_por_empresa_fk', 'executado_por', 'usuarios', 'NO ACTION'),
            ('producoes', 'producoes_ficha_tecnica_id_empresa_fk', 'ficha_tecnica_id', 'fichas_tecnicas', 'NO ACTION'),
            ('producoes', 'producoes_produto_id_empresa_fk', 'produto_id', 'produtos', 'NO ACTION'),
            ('producoes', 'producoes_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('produtos_categorias', 'produtos_categorias_categoria_id_empresa_fk', 'categoria_id', 'categorias_produto', 'NO ACTION'),
            ('produtos_categorias', 'produtos_categorias_produto_id_empresa_fk', 'produto_id', 'produtos', 'NO ACTION'),
            ('produtos_codigos', 'produtos_codigos_produto_id_empresa_fk', 'produto_id', 'produtos', 'NO ACTION'),
            ('produtos', 'produtos_importacao_id_empresa_fk', 'importacao_id', 'importacoes', 'NO ACTION'),
            ('recebimentos_conta', 'recebimentos_conta_parcela_id_empresa_fk', 'parcela_id', 'parcelas_pagamento', 'NO ACTION'),
            ('recebimentos_conta', 'recebimentos_conta_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('recebimentos_itens', 'recebimentos_itens_pedido_compra_item_id_empresa_fk', 'pedido_compra_item_id', 'pedidos_compra_itens', 'NO ACTION'),
            ('recebimentos_itens', 'recebimentos_itens_recebimento_id_empresa_fk', 'recebimento_id', 'recebimentos', 'NO ACTION'),
            ('recebimentos', 'recebimentos_pedido_compra_id_empresa_fk', 'pedido_compra_id', 'pedidos_compra', 'NO ACTION'),
            ('sequencias_sku', 'sequencias_sku_configuracao_id_empresa_fk', 'configuracao_id', 'configuracoes_sku', 'NO ACTION'),
            ('taxas_venda', 'taxas_venda_venda_id_empresa_fk', 'venda_id', 'vendas', 'NO ACTION'),
            ('transacoes_pagamento_parcelas', 'transacoes_pagamento_parcelas_transacao_pagamento_id_empresa_fk', 'transacao_pagamento_id', 'transacoes_pagamento', 'NO ACTION'),
            ('transacoes_pagamento', 'transacoes_pagamento_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('unidades_rastreadas', 'unidades_rastreadas_compra_id_empresa_fk', 'compra_id', 'compras', 'NO ACTION'),
            ('unidades_rastreadas', 'unidades_rastreadas_item_venda_id_empresa_fk', 'item_venda_id', 'itens_venda', 'NO ACTION'),
            ('usuario_privilegios', 'usuario_privilegios_concedido_por_empresa_fk', 'concedido_por', 'usuarios', 'NO ACTION'),
            ('usuario_privilegios', 'usuario_privilegios_revogado_por_empresa_fk', 'revogado_por', 'usuarios', 'NO ACTION'),
            ('usuario_privilegios', 'usuario_privilegios_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION'),
            ('vendas', 'vendas_canal_id_empresa_fk', 'canal_id', 'canais_venda', 'NO ACTION'),
            ('vendas', 'vendas_cliente_id_empresa_fk', 'cliente_id', 'clientes', 'NO ACTION'),
            ('vendas', 'vendas_usuario_id_empresa_fk', 'usuario_id', 'usuarios', 'NO ACTION')
        ) AS t(tabela, nome, coluna, pai, acao)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.nome AND conrelid = fk.tabela::regclass) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, empresa_id) REFERENCES %I (id, empresa_id) ON DELETE %s NOT VALID',
                fk.tabela, fk.nome, fk.coluna, fk.pai, fk.acao
            );
        END IF;

        BEGIN
            EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.tabela, fk.nome);
        EXCEPTION WHEN foreign_key_violation THEN
            RAISE WARNING 'Constraint % não validada: há linhas antigas de % com referência de outra empresa; vale só para linhas novas.', fk.nome, fk.tabela;
        END;
    END LOOP;
END $$;

-- Reversão manual (não executada pelo runner): para cada constraint acima,
--   ALTER TABLE <tabela> DROP CONSTRAINT IF EXISTS <tabela>_<coluna>_empresa_fk;
-- e, se desejado, DROP INDEX IF EXISTS uq_<pai>_id_empresa; (as FKs simples originais nunca foram removidas).
