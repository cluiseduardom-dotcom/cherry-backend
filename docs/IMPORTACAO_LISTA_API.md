# Importação de lista (produtos e clientes)

Estado: **PR 1 (leitura e prévia, sem gravar)**. A confirmação, o estoque inicial e o relatório entram no PR 2 (seção "Próximo PR").

Permite ao lojista que vem de caderno ou planilha trazer produtos (com custo e saldo inicial) e clientes sem digitar item por item. Migration `117`.

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
- **Estoque inicial**: se a empresa já lançou o estoque inicial em massa (`empresas.estoque_inicial_lancado_em`), `saldo` maior que 0 é erro ("saldo inicial já lançado para esta empresa"); produto novo sem saldo continua importável. A trava só é gravada pela confirmação (PR 2).
- **Local**: nome inexistente ou repetido é erro. Trânsito e reserva online não são destino.

## Segurança e LGPD

- A prévia pendente (linhas normalizadas, com dados pessoais) fica em `importacoes_previas` por no máximo 30 min e é apagada na expiração (limpeza na próxima prévia da empresa) ou na confirmação. `importacoes` (trilha) não guarda dado pessoal: quem, tipo, nome do arquivo, SHA-256, totais, status.
- O conteúdo do arquivo nunca vai para log; só metadados e hash.
- Toda consulta de contexto filtra por `empresa_id` do JWT; as tabelas novas têm FK composta com usuário, local e importação da mesma empresa.

## Próximo PR (confirmação)

`POST /importacao/confirmar` (token) em transação única; estoque inicial por `estoqueRepository.criarMovimentacao` (`tipo = entrada`, `origem = estoque_inicial`, produto sem histórico); gravação da trava por empresa; SKU e código de barras (D2); `GET /importacao/:id/relatorio` com proteção contra injeção de fórmula; vínculo `importacao_id` nos registros criados; tela em 3 passos.
