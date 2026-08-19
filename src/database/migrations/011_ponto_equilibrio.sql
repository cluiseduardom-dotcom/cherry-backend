-- Ponto de Equilíbrio (PE): duas tabelas novas no módulo Financeiro.
--
-- despesas_fixas tem soft delete (deletado_em) para exclusão real e um
-- boolean `ativo` separado para o toggle de despesas sazonais (férias, 13º)
-- sem apagar o cadastro — são dois conceitos distintos: a listagem filtra só
-- deletado_em IS NULL (mostra ativas e inativas, pra permitir reativar uma
-- despesa desligada), o cálculo do PE soma só ativo = true AND
-- deletado_em IS NULL.
--
-- configuracoes_financeiras é uma linha por empresa (PK = empresa_id, sem id
-- próprio) guardando a alíquota de imposto usada no cálculo do PE.

CREATE TABLE IF NOT EXISTS despesas_fixas (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    categoria VARCHAR(20) NOT NULL CHECK (categoria IN ('estrutural', 'pessoal', 'administrativa')),
    descricao VARCHAR(255) NOT NULL,
    valor NUMERIC(12,2) NOT NULL CHECK (valor >= 0),
    ativo BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    deletado_em TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_despesas_fixas_empresa_id ON despesas_fixas(empresa_id);

CREATE TABLE IF NOT EXISTS configuracoes_financeiras (
    empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id),
    aliquota_imposto NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (aliquota_imposto >= 0 AND aliquota_imposto <= 1),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);
