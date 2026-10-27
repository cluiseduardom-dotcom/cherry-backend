-- Consumo de insumos, fatia 1c (#150): consumo avulso (uso interno, perda, brinde...), ajustes por venda
-- (acrescentar, retirar, regularizar pendência) e base para relatório de consumo e custo por competência.
-- Migration só aditiva/relaxante. Histórico nunca é apagado: retirar uma linha de consumo é uma devolução
-- ao Central por movimentação auditada, com a linha marcada (devolvido_em + tipo + quem), não um DELETE.
-- Reversão manual: DROP TABLE consumos_avulsos; e remover as colunas/ajustar o CHECK abaixo.

-- 1) venda_consumos: origem passa a aceitar as linhas acrescentadas à venda; quem/por quê da linha e da devolução.
ALTER TABLE venda_consumos DROP CONSTRAINT IF EXISTS venda_consumos_origem_chk;
ALTER TABLE venda_consumos ADD CONSTRAINT venda_consumos_origem_chk
    CHECK (origem IN ('ficha', 'brinde', 'substituicao', 'outro'));

ALTER TABLE venda_consumos ADD COLUMN IF NOT EXISTS observacao TEXT;
ALTER TABLE venda_consumos ADD COLUMN IF NOT EXISTS criado_por INTEGER;
ALTER TABLE venda_consumos ADD COLUMN IF NOT EXISTS devolucao_tipo VARCHAR(20);
ALTER TABLE venda_consumos ADD COLUMN IF NOT EXISTS devolvido_por INTEGER;

ALTER TABLE venda_consumos ADD CONSTRAINT venda_consumos_criado_por_fk
    FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id);
ALTER TABLE venda_consumos ADD CONSTRAINT venda_consumos_devolvido_por_fk
    FOREIGN KEY (devolvido_por, empresa_id) REFERENCES usuarios (id, empresa_id);
ALTER TABLE venda_consumos ADD CONSTRAINT venda_consumos_devolucao_tipo_chk
    CHECK (devolucao_tipo IS NULL OR devolucao_tipo IN ('cancelamento', 'retirada'));

-- Linhas já devolvidas antes desta migration só podem ter sido por cancelamento da venda.
UPDATE venda_consumos SET devolucao_tipo = 'cancelamento' WHERE devolvido_em IS NOT NULL AND devolucao_tipo IS NULL;

-- 2) consumos_avulsos: saída de insumo do Central sem venda (uso próprio, perda/quebra, brinde, outro).
-- responsavel_id = quem retirou (por padrão, quem lançou); finalidade = para quê (obrigatória em uso_interno,
-- validada no backend). custo_unitario é o custo do insumo NA HORA: o gasto é reconhecido no consumo (competência).
CREATE TABLE IF NOT EXISTS consumos_avulsos (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL,
    local_id INTEGER NOT NULL,
    quantidade INTEGER NOT NULL,
    motivo VARCHAR(20) NOT NULL,
    responsavel_id INTEGER NOT NULL,
    finalidade TEXT,
    observacao TEXT,
    custo_unitario NUMERIC(10, 2) NOT NULL,
    criado_por INTEGER NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT consumos_avulsos_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
    CONSTRAINT consumos_avulsos_local_fk FOREIGN KEY (local_id, empresa_id) REFERENCES locais_estoque (id, empresa_id),
    CONSTRAINT consumos_avulsos_responsavel_fk FOREIGN KEY (responsavel_id, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT consumos_avulsos_criado_por_fk FOREIGN KEY (criado_por, empresa_id) REFERENCES usuarios (id, empresa_id),
    CONSTRAINT consumos_avulsos_quantidade_chk CHECK (quantidade > 0),
    CONSTRAINT consumos_avulsos_motivo_chk CHECK (motivo IN ('uso_interno', 'perda', 'brinde', 'outro'))
);

CREATE INDEX IF NOT EXISTS idx_consumos_avulsos_empresa_data ON consumos_avulsos (empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_consumos_avulsos_produto ON consumos_avulsos (empresa_id, produto_id);
