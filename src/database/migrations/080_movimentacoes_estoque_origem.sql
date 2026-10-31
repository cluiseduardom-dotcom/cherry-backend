-- Origem da movimentação de estoque (auditoria): de onde veio cada entrada, saída ou ajuste.
--
-- * `origem` é um código curto: 'compra', 'recebimento', 'estoque_inicial', 'recebimento_sem_compra'
--   (entradas) e 'perda', 'avaria', 'brinde', 'uso_interno', 'contagem', 'correcao', 'outro' (saídas e
--   ajustes avulsos). Coluna aditiva e anulável: movimentações antigas e os fluxos internos ainda não
--   classificados (venda, produção, transferência, consumo) ficam com NULL.
-- * O preenchimento abaixo só usa marcas inequívocas que já existem nas linhas antigas
--   (compra_id, motivo 'Recebimento #n', 'Estoque inicial', 'cancelamento_compra'); o resto não é adivinhado.

ALTER TABLE movimentacoes_estoque
    ADD COLUMN IF NOT EXISTS origem VARCHAR(40);

UPDATE movimentacoes_estoque SET origem = 'compra'
 WHERE origem IS NULL AND compra_id IS NOT NULL AND tipo = 'entrada';

UPDATE movimentacoes_estoque SET origem = 'recebimento'
 WHERE origem IS NULL AND tipo = 'entrada' AND motivo LIKE 'Recebimento #%';

UPDATE movimentacoes_estoque SET origem = 'estoque_inicial'
 WHERE origem IS NULL AND tipo = 'entrada' AND motivo = 'Estoque inicial';

UPDATE movimentacoes_estoque SET origem = 'cancelamento_compra'
 WHERE origem IS NULL AND tipo = 'saida' AND motivo = 'cancelamento_compra';
