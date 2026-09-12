# Categorias de produto configuráveis + geração automática de SKU

Data: 2026-09-12
Status: aprovado, pronto para plano de implementação

## Contexto e motivação

Hoje `POST /produtos` exige `sku` obrigatório, digitado manualmente, com checagem de unicidade global por coluna (`produtos.sku UNIQUE`, migration `002_produtos_sku.sql`). Não existe conceito de categoria estruturada — `produtos.categoria` é um campo de texto livre opcional, sem relação com precificação, estoque ou qualquer outra regra.

Esta mudança introduz categorias de produto configuráveis por empresa (com nível, código e nome) e passa a gerar o SKU automaticamente a partir da combinação de categorias atribuídas a um produto, com sequência numérica isolada por combinação e por empresa.

**Fora de escopo** (frentes futuras, sessões separadas): código de barras, geração de etiqueta, leitura de código de barras no PDV.

## Decisões de negócio já fechadas (não reabrir nesta sessão)

1. **`produtos.categoria` (texto livre) e a nova categorização estruturada não se comunicam.** Nenhuma leitura, escrita ou sincronização entre os dois. `produtos.categoria` fica marcado como deprecado (comentário de coluna na migration + nota no `CLAUDE.md`) e será removido numa etapa futura, antes do carregamento do catálogo real. As duas UIs de categoria nunca aparecem juntas na mesma tela de produto — a estruturada substitui a free-text na experiência do usuário, mesmo que o contrato de API antigo continue existindo.

2. **SKU passa a ser sempre gerado automaticamente**, nunca mais digitado manualmente. `produtos.sku` vira `NULLABLE`. Produto pode nascer sem SKU (quando criado sem categoria) e ser categorizado depois — nesse momento o SKU é gerado.

3. **Unicidade de `sku`** deixa de ser `UNIQUE` de coluna simples e passa a índice parcial único `(empresa_id, sku) WHERE sku IS NOT NULL` — único quando não-nulo, escopado por empresa.

4. **Imutabilidade do SKU**: uma vez gravado em `produtos.sku`, nunca é regravado — nem por edição de categoria, nem por qualquer outro caminho. Garantido no service (não só na UI): a rota de categorização nunca sobrescreve um `sku` já preenchido, mesmo que as categorias mudem.

5. **Permissão de categorizar um produto**: novo endpoint dedicado `PATCH /produtos/:id/categoria`, liberado para admin+estoquista (`requireEstoquista`). `PUT /produtos/:id` continua admin-only e não aceita campos de categoria — os dois endpoints não se sobrepõem.

6. **Formato do SKU**: concatenação sem separador. Ordem fixa: primeiro o bloco de códigos de categoria que contêm QUALQUER letra (ordenados por `nível` ascendente entre si), depois o bloco de códigos puramente numéricos (ordenados por `nível` ascendente entre si), depois a sequência numérica com `padStart` de no mínimo 3 dígitos (`007`, `042`, `350`, crescendo naturalmente para `1000`, `1001`... sem quebrar e sem migração manual).

7. **Chave da sequência é ancorada no texto do código da categoria (`codigo`), não no `id`.** Ver análise de colisão abaixo — isso é uma decisão de correção, não estética.

8. **`codigo` e `nível` são imutáveis após a criação da categoria.** Só `nome` (e o soft delete) são editáveis via `PUT /categorias/:id`. Motivo: qualquer edição de `codigo`/`nível` reabriria a mesma classe de colisão de sequência que motivou a decisão 7. Se o usuário errar o código ao cadastrar, o caminho é soft-delete + criar uma categoria nova — seguro sob o modelo ancorado em texto.

9. **Badge "Sem SKU"** na listagem de produtos é responsabilidade do frontend (`cherry-frontend`, repo irmão, fora deste repo) a partir de `sku: null` na resposta — mesmo padrão já usado para "sem preço definido" (`produtosService.comPrecoCanal`). Nenhuma mudança adicional é necessária no backend além do que já está descrito aqui.

## Análise de colisão de sequência (por que decisão 7 existe)

Modelo descartado: `sequencias_sku.chave_combinacao` ancorada nos `id`s das categorias (ordenados por nível).

Cenário de colisão:
1. Categoria "BR" (`id=5`, nível 1) é usada → sequência da chave `"5"` → contador 1 → SKU `BR001`.
2. Categoria "BR" (`id=5`) é soft-deletada.
3. Nova categoria "BR" (`id=42`, nível 1) é criada — passa na checagem de duplicidade porque essa checagem só considera categorias ativas (`deletado_em IS NULL`), conforme decisão de negócio já fechada sobre reaproveitamento de código.
4. Um produto é categorizado com a categoria nova (`id=42`) → chave `"42"` é uma chave *diferente* de `"5"` → sequência própria, reinicia em 1 → SKU `BR001` de novo.

Resultado: dois produtos diferentes, dois registros de sequência diferentes, mesmo SKU visível — colisão real.

Modelo adotado: `chave_combinacao` ancorada no texto do `codigo` (nível + código, ordenado por nível), não no `id`. Reexecutando o cenário: a categoria nova no passo 3 tem o mesmo `codigo` ("BR") no mesmo nível, logo mapeia para a mesma `chave_combinacao` da categoria antiga → o upsert lê o contador existente (1) e incrementa para 2 → SKU `BR002`. Sem colisão — a sequência simplesmente continua sob a mesma identidade visível, que é semanticamente mais correta: "a mesma combinação" é definida pelo texto que aparece no SKU, não por um id interno.

Isso reabre a mesma classe de risco se `codigo`/`nível` puderem ser editados numa categoria já usada (mesma mecânica, via edição em vez de delete+recriação) — por isso a decisão 8 torna esses campos imutáveis após a criação, incondicionalmente (não só "depois de usada"), o que é mais simples de implementar e testar do que travar condicionalmente.

**Rede de segurança adicional**: mesmo com a chave corrigida, mantemos o índice parcial único `(empresa_id, sku) WHERE sku IS NOT NULL` em `produtos`. Se qualquer caminho não previsto ainda produzir uma colisão, a gravação falha na constraint em vez de duplicar silenciosamente. O service captura essa violação e lança `AppError('Erro ao gerar SKU, tente novamente', 409)` — nunca um 500 não tratado. Não há retry automático: com a chave corrigida, esse caminho não deve ser alcançável em uso normal.

## Modelo de dados

### Migration `019_categorias_produto.sql`

```sql
CREATE TABLE IF NOT EXISTS categorias_produto (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    nivel INTEGER NOT NULL CHECK (nivel > 0),
    codigo VARCHAR(3) NOT NULL,
    nome VARCHAR(255) NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    deletado_em TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categorias_produto_empresa_id ON categorias_produto(empresa_id);

-- Único por (empresa, nível, código em maiúsculas) entre categorias ativas;
-- código pode ser reaproveitado depois que a categoria antiga é soft-deletada
-- (decisão de negócio) — seguro porque a sequência de SKU é ancorada no texto
-- do código, não no id (ver spec de design).
CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_produto_codigo_unico
    ON categorias_produto (empresa_id, nivel, UPPER(codigo))
    WHERE deletado_em IS NULL;

-- Tabela de vínculo produto <-> categoria. Necessária porque o número de
-- níveis é configurável por empresa (não fixo), então não dá pra representar
-- isso com colunas fixas categoria_nivel1_id/categoria_nivel2_id em produtos.
CREATE TABLE IF NOT EXISTS produtos_categorias (
    produto_id INTEGER NOT NULL REFERENCES produtos(id),
    categoria_id INTEGER NOT NULL REFERENCES categorias_produto(id),
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    PRIMARY KEY (produto_id, categoria_id)
);

CREATE INDEX IF NOT EXISTS idx_produtos_categorias_produto_id ON produtos_categorias(produto_id);

-- Contador atômico por combinação de códigos de categoria, isolado por
-- empresa. chave_combinacao = códigos das categorias atribuídas, ordenados
-- por nível ascendente, unidos por "-" (ex.: "BR-01").
CREATE TABLE IF NOT EXISTS sequencias_sku (
    id SERIAL PRIMARY KEY,
    empresa_id INTEGER NOT NULL REFERENCES empresas(id),
    chave_combinacao VARCHAR(255) NOT NULL,
    contador INTEGER NOT NULL DEFAULT 0,
    UNIQUE (empresa_id, chave_combinacao)
);

-- sku deixa de ser UNIQUE global e vira nullable + único parcial por empresa.
ALTER TABLE produtos ALTER COLUMN sku DROP NOT NULL;
ALTER TABLE produtos DROP CONSTRAINT IF EXISTS produtos_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_sku_unico
    ON produtos (empresa_id, sku)
    WHERE sku IS NOT NULL;

COMMENT ON COLUMN produtos.categoria IS
    'Deprecado: campo de texto livre substituído pela categorização estruturada (categorias_produto/produtos_categorias). Não ler nem escrever em código novo. Remoção planejada para uma etapa futura, antes do carregamento do catálogo real.';
```

`schema.sql` recebe a mesma mudança (tabelas novas + alteração em `produtos.sku`), conforme convenção do projeto.

## Geração de SKU — algoritmo

1. Recebe a lista de categorias atribuídas ao produto no momento da geração (podem ser 1..N níveis, não precisa cobrir todos os níveis configurados na empresa).
2. Separa em dois grupos pelo `codigo` (maiúsculo): grupo "letras" (contém `/[A-Z]/`) e grupo "números" (só dígitos), cada grupo ordenado por `nivel` ascendente.
3. Monta `chave_combinacao` = códigos de TODAS as categorias (ambos os grupos, na mesma ordem letras→números) unidos por `-`.
4. Executa o upsert atômico em `sequencias_sku` (`INSERT ... ON CONFLICT (empresa_id, chave_combinacao) DO UPDATE SET contador = contador + 1 RETURNING contador`) dentro de uma transação.
5. `sequencia_formatada = String(contador).padStart(3, '0')`.
6. `sku = codigosLetras.join('') + codigosNumeros.join('') + sequencia_formatada`.
7. `UPDATE produtos SET sku = $1 WHERE id = $2 AND empresa_id = $3 AND sku IS NULL` (o `AND sku IS NULL` é a última linha de defesa de imutabilidade — se por alguma race o produto já ganhou SKU entre o service checar e escrever, essa escrita vira no-op em vez de sobrescrever).
8. Se a escrita em `produtos.sku` violar o índice único parcial (colisão), captura e lança `AppError('Erro ao gerar SKU, tente novamente', 409)`.

Não usa `executarComLock`/`transicionarStatus` (`src/repositories/shared/transacoes.js`) — esse helper resolve "trava uma linha existente e ramifica por status", e aqui o problema é um contador atômico puro, melhor resolvido com upsert de banco (sem race, sem retry, sem lock explícito).

## API

### `categorias` (novo cluster: repository/service/controller/validation/routes)

Montado em `/categorias`, tudo atrás de `requireEstoquista` (admin+estoquista; vendedor não acessa).

- `GET /categorias` — lista paginada (`page`, `limit`), filtra `deletado_em IS NULL` por padrão.
- `POST /categorias` — cria. Body: `{ nivel, codigo, nome }`, schema `.strict()`. Validações: `nivel` inteiro positivo obrigatório; `codigo` string 1-3 chars obrigatória (normalizada para maiúsculas antes de checar duplicidade/gravar); `nome` obrigatório; código duplicado no mesmo nível/empresa (entre ativas) → 409.
- `PUT /categorias/:id` — edita. Body aceita **somente** `{ nome }` (schema `.strict()` sem `codigo`/`nivel`). Se o payload trouxer `codigo` ou `nivel`, retorna **400 com mensagem explicativa** ("código e nível não podem ser alterados após a criação — crie uma nova categoria") em vez de ignorar silenciosamente.
- `DELETE /categorias/:id` — soft delete (`deletado_em = NOW()`). Não cascateia: vínculos existentes em `produtos_categorias` e SKUs já gerados permanecem intactos. A categoria deletada simplesmente para de aparecer como opção em listagens/novas atribuições.

### `produtos` (rota nova em `src/routes/produtos.js`)

- `PATCH /produtos/:id/categoria` — middleware `requireEstoquista`. Body: `{ categoria_ids: number[] }`, schema `.strict()` (rejeita qualquer outro campo — não vira caminho alternativo de edição de produto). Validações: array de inteiros positivos; cada `categoria_id` existe, pertence à empresa e está ativa (`deletado_em IS NULL`); sem duas categorias do mesmo `nivel` na lista.

  Fluxo do service:
  1. Busca produto por `id` + `empresa_id` (404 se não existir).
  2. Dentro de uma transação: substitui as linhas de `produtos_categorias` do produto pelas novas (`DELETE` + `INSERT`).
  3. Se `produto.sku` já existe → não gera nada, só atualiza o vínculo.
  4. Se `produto.sku` é `null` e `categoria_ids` não é vazio → roda o algoritmo de geração de SKU (seção acima) com as categorias enviadas agora. Se `categoria_ids` for `[]` (array vazio), é um no-op sobre o SKU — só limpa o vínculo, sem gerar nada (nada para basear o SKU).
  5. Resposta passa por `filtrarParaRole` (mesmo filtro que já remove custo/margem para quem não é admin, usado em `produtosController`) e inclui as categorias vinculadas (`nivel`, `codigo`, `nome`) para a tela de edição refletir o estado atual.

`PUT /produtos/:id` não muda — continua sem aceitar campos de categoria estruturada. `GET /produtos/:id` e a listagem paginada passam a incluir as categorias vinculadas ao produto (mesmo formato), para a UI mostrar o que já foi categorizado antes de uma nova chamada a `PATCH /:id/categoria`.

## Requisito de UI (para a sessão do frontend, `cherry-frontend` — fora deste repo)

A tela de cadastro de categoria precisa avisar, **antes do salvamento**, que `codigo` e `nível` não podem ser alterados depois de criados (ex.: "o código não pode ser alterado depois de criado — confira antes de salvar"). Isso é necessário porque o backend torna esses campos imutáveis (decisão 8) e não há correção possível além de soft-delete + recriar.

## Testes

- `tests/repositories/categoriasRepository.test.js`, `tests/services/categoriasService.test.js`, `tests/routes/categorias.test.js`: CRUD, soft delete sem cascata, código duplicado 409, `PUT` com `codigo`/`nivel` no body → 400, três papéis (admin ok, estoquista ok, vendedor 403).
- Geração de SKU (`tests/services/produtosService.test.js` ou arquivo novo dedicado): 1 nível, 2 níveis, categoria com letra fora de ordem numérica (letra sempre na frente), sequência incrementando na 2ª geração da mesma combinação, estouro 999→1000 sem quebrar, imutabilidade (categorizar de novo não altera SKU existente), cenário de soft-delete + recriação de código igual (sequência continua a mesma, não reinicia — prova da correção da decisão 7).
- `tests/routes/produtos.test.js`: `PATCH /:id/categoria` nos três papéis (admin ok, estoquista ok, vendedor 403), payload com campo extra → 400, resposta sem custo/margem.

## Arquivos tocados (referência para o plano)

- `src/database/migrations/019_categorias_produto.sql` (novo)
- `schema.sql` (atualizado)
- `src/repositories/categoriasRepository.js`, `src/services/categoriasService.js`, `src/controllers/categoriasController.js`, `src/validations/categoriasValidation.js`, `src/routes/categorias.js` (novos)
- `src/app.js` (ou onde as rotas são montadas) — registrar `/categorias`
- `src/repositories/produtosRepository.js` (nova função de escrita de SKU + busca/inclusão de categorias vinculadas em `buscarPorId`/`listarPaginado`)
- `src/services/produtosService.js` (algoritmo de geração de SKU, fluxo de categorização)
- `src/controllers/produtosController.js`, `src/validations/produtosValidation.js`, `src/routes/produtos.js` (endpoint `PATCH /:id/categoria`)
- `CLAUDE.md` (nota de deprecação de `produtos.categoria`, regra fechada do formato de SKU, entrada de módulo pronto)
- Testes listados acima
