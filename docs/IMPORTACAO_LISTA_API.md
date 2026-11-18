# Importação de lista (produtos e clientes)

Estado: **PR 1 (prévia, sem gravar) e PR 2 (confirmação, estoque inicial e relatório)**. Migrations `117` e `118`.

Permite ao lojista que vem de caderno ou planilha trazer produtos (com custo e saldo inicial) e clientes sem digitar item por item. Fluxo: **enviar o arquivo, ver a prévia, confirmar**.

## Acesso

- Só **admin** (o arquivo traz custo e dados pessoais). Vendedor e Estoquista recebem 403.
- Só com a funcionalidade **`importacao_lista`** ligada para a empresa (Painel GiroNex). Nenhum plano a inclui; a GiroNex liga avulsa. Sem ela: `403 "Funcionalidade não incluída no seu plano. Fale com a GiroNex."`.
- `empresa_id` e o usuário vêm sempre do JWT; campo `empresa_id`/`usuario_id` no corpo é recusado (400).

## Formato: só CSV (decisão do PO)

XLSX fica para depois, com a biblioteca que o PO aprovar. `formato=xlsx` responde 400.

- Até **5 MB** e **2.000 linhas de dados** por arquivo. Acima: 413 / 400 com mensagem clara.
- O tipo é conferido pelo **conteúdo**: `.xlsx`, `.xlsm`, `.xls`, PDF e binário (byte nulo, como UTF-16) são recusados, mesmo com nome `.csv`.
- UTF-8 (com ou sem BOM) ou Windows-1252. Separador `;`, `,` ou tabulação, detectado na primeira linha. Aspas duplas, `""` e quebra de linha dentro de aspas funcionam.
- Nada é executado: fórmula (`=`, `+`, `-`, `@`) é lida como texto. O arquivo **não é guardado**.
- Um arquivo por tipo (`produtos` ou `clientes`); importe um e depois o outro.

## Endpoints

### `GET /importacao/modelo?tipo=produtos|clientes&formato=csv`

Baixa a planilha-modelo (`text/csv`, anexo): só o cabeçalho, com BOM e `;` (abre certo no Excel em português). `formato` padrão `csv`.

### `POST /importacao/previa` (multipart/form-data)

| Campo | Obrigatório | Regra |
|---|---|---|
| `arquivo` | sim | um único arquivo CSV |
| `tipo` | sim | `produtos` ou `clientes` |
| `local_padrao_id` | não | só `produtos`: local do estoque inicial das linhas sem `local`. Padrão: Central |

Cota: **10 prévias por hora por empresa** (429 depois).

Resposta `200`:

```json
{
  "success": true,
  "data": {
    "importacao_id": 55,
    "tipo": "produtos",
    "token": "k3...43 caracteres... (null se não há nada a confirmar)",
    "expira_em": "2026-11-17T15:30:00.000Z",
    "totais": { "linhas": 200, "validas": 180, "com_aviso": 12, "com_erro": 8, "a_criar": 190, "ignoradas": 2 },
    "pode_confirmar": false,
    "pode_confirmar_somente_validas": true,
    "problemas": [
      { "linha": 4, "coluna": "custo", "nivel": "erro", "motivo": "valor inválido: use apenas números, como 12,50" },
      { "linha": 5, "coluna": null, "nivel": "aviso", "motivo": "nome repetido no arquivo (linha 2); a linha foi ignorada" }
    ],
    "problemas_truncados": false,
    "avisos_do_arquivo": ["Preço de venda não é importado: depois da importação, defina em \"Precificar por canal\""],
    "colunas_ignoradas": ["preço"]
  }
}
```

- `linha` é a **linha física do arquivo** (a 1 é o cabeçalho). `coluna` é `null` quando o problema é da linha toda.
- `nivel`: `erro` (a linha não entra) ou `aviso` (entra, ou é ignorada por duplicidade; o `motivo` diz qual).
- `totais`: `a_criar` + `ignoradas` + `com_erro` = `linhas`. `validas` = a criar sem aviso. `com_aviso` conta linhas com ao menos um aviso.
- `pode_confirmar`: sem nenhum erro e com algo a criar. `pode_confirmar_somente_validas`: há erros, mas algo a criar (o PR 2 só confirma assim com opção explícita).
- `problemas` vem cortado em 1.000 (`problemas_truncados: true`); corrija e reenvie.
- `token`: uso único, **expira em 30 minutos**; só o hash fica no servidor. É `null` se nenhuma linha pode ser criada (nada é guardado). Nunca registre o token em log.
- Erros de arquivo (cabeçalho sem coluna obrigatória, coluna repetida, aspas abertas, Excel, vazio, acima do limite) respondem 400/413 com `{ "success": false, "message": "..." }`, sem prévia.
- Reenviar o arquivo corrigido gera uma nova prévia (novo token); a anterior só expira sozinha.

### `POST /importacao/confirmar` (JSON)

```json
{ "token": "<token da prévia>", "somente_validas": false }
```

`somente_validas` (padrão `false`): com erro na prévia, a confirmação é **bloqueada** (409) a menos que o admin peça explicitamente para confirmar só as linhas válidas (`true`). As linhas com erro nunca são gravadas.

Grava tudo numa **única transação**: se qualquer parte falhar, **nada** é gravado e o token continua válido (corrija o problema e confirme de novo, ou refaça a prévia). Resposta `201`:

```json
{
  "success": true,
  "data": {
    "importacao_id": 55,
    "tipo": "produtos",
    "criados": 190,
    "ignorados": 2,
    "nao_importados": 8,
    "skus_gerados": 120,
    "com_estoque_inicial": 150,
    "unidades_estoque_inicial": 2310,
    "codigos_gerados": 150,
    "sem_preco": 190,
    "relatorio_url": "/importacao/55/relatorio"
  }
}
```

- `ignorados`: duplicados (da prévia, mais os que apareceram entre a prévia e a confirmação). `nao_importados`: linhas com erro (contadas por linha).
- `sem_preco` (só produtos): todo produto criado nasce **sem preço**. A tela de resultado deve oferecer o atalho para **"Precificar por canal"** com a lista "Produtos sem preço".
- Para clientes, a resposta não tem `sem_preco`; os campos de estoque vêm zerados.
- Erros: `404` token desconhecido, de outra empresa ou já usado; `410` prévia expirada (30 min); `409` prévia com erro sem `somente_validas`, importação já confirmada, ou o estado mudou depois da prévia (saldo inicial já lançado, categoria removida, local indisponível: refaça a prévia); `400` corpo inválido (token fora do formato, campo extra como `empresa_id`).
- Quem confirma pode ser outro admin da mesma empresa que gerou a prévia. A empresa e o usuário vêm sempre do JWT.

### `GET /importacao/:id/relatorio`

CSV (`text/csv`, anexo `relatorio-importacao-<id>.csv`, BOM + `;`) com **uma linha por linha do arquivo**: `linha;resultado;id;nome;sku;saldo;detalhe` (produtos) ou `linha;resultado;id;detalhe` (clientes, sem nome nem telefone: LGPD). `resultado`: `criado`, `ignorado` ou `nao_importado` (com a coluna e o motivo em `detalhe`). Texto que começa com `=`, `+`, `-` ou `@` sai com apóstrofo na frente (proteção contra injeção de fórmula). `404` se a importação é de outra empresa; `409` antes da confirmação.

## Colunas (cabeçalho em português, qualquer ordem, qualquer caixa, sem acento obrigatório)

**produtos**

| Coluna | Obrigatória | Regra |
|---|---|---|
| `nome` | sim | 2 a 120 caracteres; espaços colapsados |
| `custo` | sim | maior que 0, até 2 casas. Aceita `12,50`, `12.50`, `R$ 1.234,56`. `1.234` (um ponto + 3 dígitos) é mil duzentos e trinta e quatro |
| `saldo` | não | inteiro maior ou igual a 0, até 1.000.000; vazio = 0 |
| `sku` | não | até 50 caracteres (letras, números, `. - _ /`), vira maiúsculo; único por empresa |
| `categoria` | não | **nome** de categoria de produto existente (não cria categoria nova) |
| `local` | não | nome de local ativo (Central, maleta ou consignado); vazio = local padrão da tela |

**clientes**

| Coluna | Obrigatória | Regra |
|---|---|---|
| `nome` | sim | 2 a 120 caracteres |
| `telefone` | sim | vira só dígitos; 10 ou 11 com DDD. DDI 55 ou zero inicial são removidos **com aviso**. Celular de 11 dígitos começa com 9 depois do DDD |
| `nascimento` | não | `DD/MM/AAAA` ou `AAAA-MM-DD`; data real, de 1900 em diante, não futura |
| `observacoes` | não | até 500 caracteres |

Sinônimos aceitos: `observacao`, `data de nascimento`, `celular`, `whatsapp`. Qualquer outra coluna é ignorada com aviso; `preço` tem aviso próprio (preço não é importado).

## Regras de negócio da prévia

- **Preço de venda não é importado** (decisão do PO): o produto é cadastrado só com custo; o preço vem depois em "Precificar por canal". Todo produto criado fica "sem preço".
- **SKU**: informado, ou gerado pelo padrão da empresa a partir da **categoria** (na confirmação). Sem SKU e sem categoria existente, a linha é erro. Se o padrão exige mais de um nível e só há uma categoria, é erro orientando a informar o SKU (a prévia confere sem consumir a sequência).
- **Categoria desconhecida**: aviso se há SKU (o produto entra sem categoria); erro se não há SKU. Nome de categoria repetido em níveis diferentes: erro.
- **Duplicidade de produto** (mesmo SKU, ou mesmo nome sem acento, caixa e espaços extras, entre produtos vendáveis da empresa, e dentro do arquivo): **aviso e a linha é ignorada** (não atualiza). A primeira ocorrência no arquivo vale. Insumo não conflita.
- **Duplicidade de cliente**: mesmo telefone normalizado na empresa ou no arquivo: aviso, ignorada.
- **Estoque inicial**: a coluna `saldo` vira uma **entrada** (`tipo = entrada`, `origem = estoque_inicial`, motivo "Estoque inicial") no local da linha ou no local padrão, só em produto novo (sem saldo nem movimentação). A trava por empresa (`empresas.estoque_inicial_lancado_em`) é gravada na mesma transação; depois dela, `saldo` maior que 0 é erro na prévia ("saldo inicial já lançado para esta empresa") e na confirmação, e produto novo **sem saldo** continua importável. Quem precisar de um segundo estoque inicial pede ao admin da plataforma, que zera a trava (a rota do Painel GiroNex ainda não existe). Não há entrada livre: o estoque inicial em massa só nasce aqui (o avulso por produto segue só para admin, em produto sem histórico).
- **SKU e código de barras**: SKU informado vale como veio; sem SKU, é gerado pelo padrão da empresa a partir da categoria (registrado em `historico_sku`). Todo produto que entra com saldo maior que 0 recebe um código interno de etiqueta (o curto de 6 dígitos ou, se ocupado, o longo), na mesma transação.
- **Concorrência**: duas confirmações da mesma empresa nunca correm juntas (lock da importação e da empresa). O token é de uso único: a segunda tentativa responde 404.
- **Local**: nome inexistente ou repetido é erro. Trânsito e reserva online não são destino.

## Rastreabilidade

Cada produto e cada cliente criado guarda `importacao_id` (vínculo com `importacoes`), o que permite auditar e, no futuro, reverter em massa (a reversão fica fora da v1). `importacoes` guarda quem, quando, tipo, nome do arquivo, SHA-256, totais, status (`previa`, `confirmada`, `expirada`) e o relatório.

## Desempenho

A gravação é em bloco: produtos, categorias, histórico de SKU, códigos e clientes em instruções de até 500 linhas; o estoque inicial em 3 instruções por bloco (`estoqueRepository.criarEntradasIniciaisEmLote`). Medido com 2.000 produtos, todos com saldo e SKU gerado: cerca de 4 mil queries (2 por linha, ambas do gerador de SKU, que precisa do contador atômico por combinação). Com SKU informado em todas as linhas, são dezenas de queries.

## Segurança e LGPD

- A prévia pendente (linhas normalizadas, com dados pessoais) fica em `importacoes_previas` por no máximo 30 min e é apagada na expiração (limpeza na próxima prévia da empresa) ou na confirmação. `importacoes` (trilha e relatório) não guarda dado pessoal: quem, tipo, nome do arquivo, SHA-256, totais, status e, no relatório, número da linha, id, SKU e motivo (cliente sem nome nem telefone).
- O conteúdo do arquivo nunca vai para log; só metadados e hash.
- Toda consulta de contexto filtra por `empresa_id` do JWT; as tabelas novas têm FK composta com usuário, local e importação da mesma empresa.
