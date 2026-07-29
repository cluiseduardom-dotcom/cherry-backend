-- Multi-tenant: introduz a tabela `empresas` e a coluna `empresa_id` em toda
-- tabela que guarda dado de negócio de um cliente do ERP. A joalheira atual
-- vira o primeiro registro de `empresas` (seed abaixo) e todo dado já
-- existente é migrado pra ela antes de a coluna virar NOT NULL, pra não
-- quebrar linhas já gravadas.
--
-- Tabelas cobertas: usuarios, clientes, produtos, canais_venda, precos_produto,
-- vendas, itens_venda, movimentacoes_estoque, contas_pagar. canais_venda e
-- precos_produto não estavam na lista original do pedido, mas foram incluídas
-- por decisão explícita: canais de venda podem variar por empresa no futuro,
-- e precos_produto é dado transacional (ledger de preço), então ambas seguem
-- a mesma regra "toda consulta filtra por empresa_id".
--
-- Esta migration NÃO altera nenhuma UNIQUE constraint existente (ex:
-- usuarios.email, produtos.sku, canais_venda.nome continuam globalmente
-- únicos, não únicos por empresa). Isso é decisão de regra de negócio fora do
-- escopo desta tarefa — ver CLAUDE.md.

CREATE TABLE IF NOT EXISTS empresas (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    cnpj VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'inativa')),
    criado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO empresas (nome, cnpj, status)
SELECT 'Cherry Semijoias', NULL, 'ativa'
WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE nome = 'Cherry Semijoias');

-- usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
UPDATE usuarios SET empresa_id = (SELECT id FROM empresas WHERE nome = 'Cherry Semijoias') WHERE empresa_id IS NULL;
ALTER TABLE usuarios ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_id ON usuarios(empresa_id);

-- clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
UPDATE clientes SET empresa_id = (SELECT id FROM empresas WHERE nome = 'Cherry Semijoias') WHERE empresa_id IS NULL;
ALTER TABLE clientes ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_empresa_id ON clientes(empresa_id);

-- produtos
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
UPDATE produtos SET empresa_id = (SELECT id FROM empresas WHERE nome = 'Cherry Semijoias') WHERE empresa_id IS NULL;
ALTER TABLE produtos ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_produtos_empresa_id ON produtos(empresa_id);

-- canais_venda
ALTER TABLE canais_venda ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
UPDATE canais_venda SET empresa_id = (SELECT id FROM empresas WHERE nome = 'Cherry Semijoias') WHERE empresa_id IS NULL;
ALTER TABLE canais_venda ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canais_venda_empresa_id ON canais_venda(empresa_id);

-- precos_produto
ALTER TABLE precos_produto ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
UPDATE precos_produto SET empresa_id = (SELECT id FROM empresas WHERE nome = 'Cherry Semijoias') WHERE empresa_id IS NULL;
ALTER TABLE precos_produto ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_precos_produto_empresa_id ON precos_produto(empresa_id);

-- vendas
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
UPDATE vendas SET empresa_id = (SELECT id FROM empresas WHERE nome = 'Cherry Semijoias') WHERE empresa_id IS NULL;
ALTER TABLE vendas ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendas_empresa_id ON vendas(empresa_id);

-- itens_venda
ALTER TABLE itens_venda ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
UPDATE itens_venda SET empresa_id = (SELECT id FROM empresas WHERE nome = 'Cherry Semijoias') WHERE empresa_id IS NULL;
ALTER TABLE itens_venda ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_itens_venda_empresa_id ON itens_venda(empresa_id);

-- movimentacoes_estoque
ALTER TABLE movimentacoes_estoque ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
UPDATE movimentacoes_estoque SET empresa_id = (SELECT id FROM empresas WHERE nome = 'Cherry Semijoias') WHERE empresa_id IS NULL;
ALTER TABLE movimentacoes_estoque ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimentacoes_estoque_empresa_id ON movimentacoes_estoque(empresa_id);

-- contas_pagar
ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id);
UPDATE contas_pagar SET empresa_id = (SELECT id FROM empresas WHERE nome = 'Cherry Semijoias') WHERE empresa_id IS NULL;
ALTER TABLE contas_pagar ALTER COLUMN empresa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contas_pagar_empresa_id ON contas_pagar(empresa_id);
