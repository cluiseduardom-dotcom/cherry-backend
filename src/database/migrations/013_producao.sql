-- Migration 013: Módulo de Produção (Fase C — ver MAPA_CHERRY_ERP.md §7/§8).
-- fichas_tecnicas é o "receituário" de um produto acabado: quais insumos e em
-- que quantidade ele consome pra ser fabricado. Nunca UPDATE pra alterar uma
-- ficha: uma nova versão é um INSERT com vigente = true, e a versão anterior
-- é marcada vigente = false na mesma transação (repositório cuida da ordem:
-- primeiro derruba a antiga, depois insere a nova, pra nunca violar o índice
-- único parcial abaixo mesmo que por um instante).
--
-- Divergência: o índice único parcial (vigente = true por produto_id+empresa_id)
-- foi pedido explicitamente no brief. precos_produto, que o brief citou como
-- inspiração, NA VERDADE não usa flag de vigência nenhuma — resolve "preço
-- atual" só por ordem de criado_em (linha mais recente vence). Aqui é um
-- mecanismo novo e mais explícito, não uma repetição do que já existe.
--
-- quantidade_necessaria é INTEGER, não NUMERIC: produtos.estoque_atual e
-- movimentacoes_estoque.quantidade já são INTEGER em todo o sistema. Um
-- consumo fracionário de insumo quebraria estoqueRepository.criarMovimentacao
-- na hora de gravar a movimentação (INTEGER não aceita fração). Suportar
-- consumo fracionário exigiria repensar o ledger de estoque inteiro — fora
-- do escopo desta tarefa.

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'acabado' CHECK (tipo IN ('acabado', 'insumo'));

CREATE TABLE IF NOT EXISTS fichas_tecnicas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    vigente BOOLEAN NOT NULL DEFAULT true,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fichas_tecnicas_vigente_unica ON fichas_tecnicas(empresa_id, produto_id) WHERE vigente = true;
CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_empresa_id ON fichas_tecnicas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_fichas_tecnicas_produto_id ON fichas_tecnicas(produto_id);

CREATE TABLE IF NOT EXISTS itens_ficha_tecnica (
    id SERIAL PRIMARY KEY,
    ficha_tecnica_id INTEGER NOT NULL REFERENCES fichas_tecnicas(id),
    insumo_produto_id INTEGER NOT NULL REFERENCES produtos(id),
    quantidade_necessaria INTEGER NOT NULL CHECK (quantidade_necessaria > 0),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id)
);

CREATE INDEX IF NOT EXISTS idx_itens_ficha_tecnica_ficha_tecnica_id ON itens_ficha_tecnica(ficha_tecnica_id);
CREATE INDEX IF NOT EXISTS idx_itens_ficha_tecnica_insumo_produto_id ON itens_ficha_tecnica(insumo_produto_id);
CREATE INDEX IF NOT EXISTS idx_itens_ficha_tecnica_empresa_id ON itens_ficha_tecnica(empresa_id);

CREATE TABLE IF NOT EXISTS producoes (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    ficha_tecnica_id INTEGER NOT NULL REFERENCES fichas_tecnicas(id),
    quantidade_solicitada INTEGER NOT NULL CHECK (quantidade_solicitada > 0),
    quantidade_produzida INTEGER NOT NULL CHECK (quantidade_produzida >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida', 'cancelada')),
    usuario_id INTEGER REFERENCES usuarios(id),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_producoes_empresa_id ON producoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_producoes_produto_id ON producoes(produto_id);
CREATE INDEX IF NOT EXISTS idx_producoes_ficha_tecnica_id ON producoes(ficha_tecnica_id);
