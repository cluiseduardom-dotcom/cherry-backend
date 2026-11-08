-- Loja online — aviso de pedido pago e "entrega combinada".
--
-- Depois do pagamento, a entrega (frete e endereço) é combinada com a cliente por contato humano: o Vertumno ainda não
-- guarda endereço nem calcula frete. Para a equipe não perder pedido pago, o pedido passa a registrar QUANDO e POR QUEM a
-- entrega foi combinada; enquanto não for, ele aparece no sino de avisos e na tela "Pedidos da loja".
--
-- Só acrescenta colunas opcionais (NULL = ainda a combinar) e um índice. Nenhuma linha existente muda.
-- Reversão manual no rodapé.

ALTER TABLE pedidos_loja
    ADD COLUMN IF NOT EXISTS entrega_combinada_em TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS entrega_combinada_por INTEGER,
    ADD COLUMN IF NOT EXISTS entrega_observacao VARCHAR(500);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_loja_entrega_chk' AND conrelid = 'pedidos_loja'::regclass) THEN
        -- Só pedido PAGO pode ter entrega combinada.
        ALTER TABLE pedidos_loja ADD CONSTRAINT pedidos_loja_entrega_chk CHECK (entrega_combinada_em IS NULL OR status = 'pago');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_loja_entrega_usuario_fk' AND conrelid = 'pedidos_loja'::regclass) THEN
        ALTER TABLE pedidos_loja ADD CONSTRAINT pedidos_loja_entrega_usuario_fk
            FOREIGN KEY (entrega_combinada_por, empresa_id) REFERENCES usuarios (id, empresa_id);
    END IF;
END $$;

-- Os pedidos que ainda esperam contato (o que o sino e a tela consultam).
CREATE INDEX IF NOT EXISTS idx_pedidos_loja_a_combinar ON pedidos_loja (empresa_id, pago_em)
    WHERE status = 'pago' AND entrega_combinada_em IS NULL;

-- Reversão manual (não executada pelo runner):
--   DROP INDEX IF EXISTS idx_pedidos_loja_a_combinar;
--   ALTER TABLE pedidos_loja DROP CONSTRAINT IF EXISTS pedidos_loja_entrega_usuario_fk;
--   ALTER TABLE pedidos_loja DROP CONSTRAINT IF EXISTS pedidos_loja_entrega_chk;
--   ALTER TABLE pedidos_loja DROP COLUMN IF EXISTS entrega_observacao, DROP COLUMN IF EXISTS entrega_combinada_por, DROP COLUMN IF EXISTS entrega_combinada_em;
