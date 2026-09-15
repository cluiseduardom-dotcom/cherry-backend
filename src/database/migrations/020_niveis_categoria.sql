-- Rótulo do que cada categorias_produto.nivel significa para a empresa
-- (ex.: Cherry: 1=família, 2=material, 3=gênero; outra empresa pode usar
-- conceitos totalmente diferentes). Tabela INDEPENDENTE de categorias_produto
-- — deliberadamente sem FK de nivel para cá. Motivo: hoje é possível criar
-- uma categoria em qualquer nível sem rótulo pré-cadastrado; uma FK exigiria
-- o rótulo antes da categoria, quebrando esse fluxo e qualquer dado já
-- existente. Renomear ou remover um rótulo aqui NUNCA afeta
-- categorias_produto nem a geração de SKU (que é ancorada no texto do
-- `codigo`, nunca no rótulo do nível) — puramente display.
CREATE TABLE IF NOT EXISTS niveis_categoria (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nivel INTEGER NOT NULL CHECK (nivel > 0),
    nome VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (empresa_id, nivel)
);

CREATE INDEX IF NOT EXISTS idx_niveis_categoria_empresa_id ON niveis_categoria(empresa_id);
