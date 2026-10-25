# Comissões — contrato da API e guia para as telas

Este documento é o contrato que o frontend deve seguir. O backend (PR #126) calcula, congela e estorna a comissão; as telas só consultam e configuram. **Nada de cálculo de comissão no frontend.**

## Regras de negócio (para o texto da tela)

- A comissão é **por venda**. Ela **nasce `pendente`** quando a venda é finalizada e só vale conforme o **pagamento** é registrado.
- **Liberação proporcional ao que foi pago**: a cada parcela recebida, libera-se a parte correspondente (ex.: venda de R$ 100 em 3x com comissão de R$ 10 → 3,33 → 6,66 → 10,00). Pix e débito são pagos na hora: a comissão já nasce liberada. O total liberado ao fim é sempre o valor exato, sem resto de centavos.
- **Dinheiro recebido pelo vendedor** não libera sozinho: vira um **repasse "a repassar"** e a comissão daquela parte fica pendente até um **financeiro/gerente/admin (capacidade `gerir_financeiro`) confirmar que o dinheiro chegou**. O próprio vendedor nunca confirma o seu repasse.
- **Estorno de pagamento** reduz a parte liberada. **Cancelar a venda** estorna a comissão (continua listada como `estornada`, sai dos totais) e cancela os repasses ainda pendentes.
- Todo movimento (apuração, liberação, redução, estorno) fica no **histórico** da comissão, com quem fez.
- Base de cálculo = **subtotal − desconto** (sem os juros do crediário). O percentual fica **congelado** na venda.
- Percentual do vendedor prevalece sobre o **padrão da empresa**. Percentual `0` desliga a comissão daquele vendedor. Sem percentual (nem padrão) = sem comissão.
- **A dona (cargo `admin`) não recebe comissão pelo padrão da empresa.** Só se o admin tiver percentual **próprio** definido (`PUT /comissoes/percentuais` com o `usuario_id` dele). Na tela de percentuais, `usa_padrao: false` e `percentual: null` para admin = "sem comissão".
- Vendas anteriores à ativação do módulo **não têm comissão**. Estoquista e faturista não recebem comissão.
- Vendas pelo contrato legado (sem `pagamentos[]`): à vista libera na hora; a prazo libera quando a conta a receber é marcada como recebida.

## Quem acessa o quê (o backend é a fronteira; o frontend só esconde)

| Rota | Quem | Observação |
|---|---|---|
| `GET /comissoes/minhas` | admin e perfil vendedor (inclui gerente) | Sempre o usuário do token. Nenhum parâmetro escolhe outro usuário. |
| `GET /comissoes/equipe` | quem tem a capacidade `ver_vendas_de_todos` (admin tem todas) | Gerente precisa ter o cargo ligado (ver abaixo). |
| `GET /comissoes/repasses` | admin e perfil vendedor | Vendedor comum vê só os **seus**; quem tem `ver_vendas_de_todos` ou `gerir_financeiro` (e o admin) vê os da empresa. |
| `POST /comissoes/repasses/:id/confirmar` | quem tem `gerir_financeiro` (Analista financeiro, Diretor, Gerente; admin tem todas) | **Nunca o próprio vendedor** (403). |
| `GET /comissoes/:id/historico` | admin e perfil vendedor | Vendedor comum só da **própria** comissão (de outro = 404); gerente/admin, qualquer da empresa. |
| `GET /comissoes/percentuais` | só admin | |
| `PUT /comissoes/percentuais` | só admin | |

Envelope das respostas: sucesso `{ "success": true, "data": ... }`; erro `{ "success": false, "message": "..." }` (400 validação, 401 sem sessão, 403 sem permissão, 404 não encontrado).

## Formatos

Valores monetários e percentuais vêm como **string** (NUMERIC do Postgres), ex.: `"10.00"`, `"5.0000"`. Formatar para exibição; **não somar no cliente** (os totais já vêm prontos do backend). Datas de filtro: `YYYY-MM-DD`.

### `GET /comissoes/minhas?page=1&pageSize=20&data_inicio=2026-10-01&data_fim=2026-10-31`

Todos os parâmetros são opcionais. `pageSize` máximo 100.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 12,
        "venda_id": 340,
        "data_venda": "2026-10-23T14:02:11.000Z",
        "percentual": "5.0000",
        "base_calculo": "200.00",
        "valor": "10.00",
        "valor_liberado": "3.33",
        "valor_pendente": "6.67",
        "status": "parcial",
        "criado_em": "2026-10-23T14:02:11.000Z",
        "estornado_em": null
      }
    ],
    "totais": {
      "total_base": "200.00",
      "total_comissao": "10.00",
      "total_liberado": "3.33",
      "total_pendente": "6.67",
      "total_estornado": "0",
      "dinheiro_a_repassar": "40.00"
    },
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- `valor` = comissão total da venda; `valor_liberado` = parte já liberada pelo pagamento; `valor_pendente` = o que falta liberar (`"0"` se estornada).
- `status`: `pendente` (nada liberado) | `parcial` | `liberada` | `estornada`.
- `totais` cobrem **todo o filtro** (não só a página). `total_comissao` = soma do valor das **não estornadas** (= `total_liberado` + `total_pendente`); `total_estornado` soma as estornadas.
- `dinheiro_a_repassar` = dinheiro que o vendedor recebeu e ainda **não foi confirmado** (saldo atual; ignora o filtro de período).
- `total` (número) = quantidade de comissões no filtro.

### `GET /comissoes/equipe?data_inicio=...&data_fim=...`

Cada linha traz `ativo`. Usuário **bloqueado** só aparece se tiver comissão no período (o histórico não some); sem comissão, sai da lista.

Sem paginação. Ordenado por `total_comissao` decrescente. Inclui quem não vendeu no período. Não inclui estoquista/faturista.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "usuario_id": 2,
        "nome": "Ana",
        "cargo": "vendedor",
        "percentual": "5.0000",
        "quantidade_vendas": "3",
        "total_base": "300.00",
        "total_comissao": "15.00",
        "total_liberado": "10.00",
        "total_pendente": "5.00",
        "total_estornado": "0",
        "dinheiro_a_repassar": "20.00"
      }
    ],
    "totais": {
      "total_base": "300.00",
      "total_comissao": "15.00",
      "total_liberado": "10.00",
      "total_pendente": "5.00",
      "total_estornado": "0.00",
      "dinheiro_a_repassar": "20.00"
    }
  }
}
```

- `percentual` é o vigente (próprio ou herdado do padrão); `null` = sem comissão configurada (inclui o admin sem percentual próprio).
- `quantidade_vendas` vem como string (converter com `Number`).

### `GET /comissoes/repasses?status=a_repassar&page=1&pageSize=20`

`status` opcional: `a_repassar` | `confirmado` | `cancelado`. Vendedor comum: só os seus. Gerente/admin: todos.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 8, "venda_id": 340, "pagamento_id": 51,
        "vendedor_id": 2, "vendedor_nome": "Ana",
        "valor": "60.00", "status": "a_repassar",
        "declarado_em": "2026-10-23T14:02:11.000Z",
        "confirmado_em": null, "confirmado_por": null, "confirmado_por_nome": null,
        "observacao": null
      }
    ],
    "totais": { "total_a_repassar": "60.00" },
    "page": 1, "pageSize": 20, "total": 1, "totalPages": 1
  }
}
```

- O repasse é criado **automaticamente** quando a venda tem pagamento em dinheiro e comissão. `declarado_em` = quando o vendedor registrou a venda. Vendas sem comissão (ex.: da dona) não geram repasse.
- `cancelado` = a venda foi cancelada antes da confirmação.

### `POST /comissoes/repasses/:id/confirmar` (`gerir_financeiro`)

Corpo opcional: `{ "observacao": "Recebi na loja" }` (até 300 caracteres; campos extras são recusados). Resposta: o repasse com `status: "confirmado"`, `confirmado_por`, `confirmado_em`.

- Libera a parte da comissão daquele dinheiro (mesma transação) e grava no histórico.
- Erros: 403 (o confirmador é o próprio vendedor), 404 (inexistente ou de outra empresa), 409 (já confirmado ou cancelado).
- Sugestão de tela ("Repasses pendentes"): lista `a_repassar` com botão **Confirmar recebimento** (confirmação em dois toques, é uma ação financeira).

### `GET /comissoes/:id/historico`

```json
{
  "success": true,
  "data": {
    "comissao": { "id": 12, "venda_id": 340, "usuario_id": 2, "percentual": "10.0000", "base_calculo": "100.00", "valor": "10.00", "valor_liberado": "4.00", "status": "parcial" },
    "eventos": [
      { "id": 1, "tipo": "apurada",   "origem": "venda",     "delta": "0.00", "valor_liberado_apos": "0.00", "repasse_id": null, "executado_por": null, "executado_por_nome": null, "criado_em": "..." },
      { "id": 2, "tipo": "liberacao", "origem": "venda",     "delta": "4.00", "valor_liberado_apos": "4.00", "repasse_id": null, "executado_por": 2, "executado_por_nome": "Ana", "criado_em": "..." },
      { "id": 3, "tipo": "liberacao", "origem": "repasse",   "delta": "6.00", "valor_liberado_apos": "10.00", "repasse_id": 8, "executado_por": 4, "executado_por_nome": "Marcos", "criado_em": "..." }
    ]
  }
}
```

- `tipo`: `apurada` | `liberacao` (+) | `reducao` (−, estorno de pagamento) | `estorno` (venda cancelada).
- `origem`: `venda` | `pagamento` (parcela recebida) | `repasse` | `estorno_pagamento` | `cancelamento_venda` | `conta_receber` (venda legada).
- `delta` negativo em `reducao`/`estorno`. Ordem cronológica. Usar texto legível por `tipo` + `origem`, não mostrar os códigos.

### `GET /comissoes/percentuais` (admin)

Lista só usuários **ativos** (bloquear um vendedor o tira daqui).

```json
{
  "success": true,
  "data": {
    "padrao": "3.0000",
    "usuarios": [
      { "usuario_id": 2, "nome": "Ana", "cargo": "vendedor", "percentual": "5.0000", "usa_padrao": false },
      { "usuario_id": 3, "nome": "Bia", "cargo": "vendedor", "percentual": null, "usa_padrao": true },
      { "usuario_id": 1, "nome": "Emilly", "cargo": "admin", "percentual": null, "usa_padrao": false }
    ]
  }
}
```

- `padrao: null` = a empresa não definiu padrão.
- `usuarios[].percentual: null` com `usa_padrao: true` = o vendedor **herda o padrão**; com `usa_padrao: false` (cargo admin) = **sem comissão**.

### `PUT /comissoes/percentuais` (admin)

```json
{ "usuario_id": 2, "percentual": 5 }
```

- `usuario_id` omitido ou `null` → define o **padrão da empresa**.
- `percentual`: número de 0 a 100, até 4 casas decimais (enviar `number`, não string). `null` → **remove** a regra (o vendedor volta a herdar o padrão; no caso do padrão, a empresa fica sem padrão).
- Campos extras são recusados (400). Resposta: `{ "usuario_id": 2, "percentual": "5.0000" }` (ou `percentual: null` ao remover).
- Erros: 400 (percentual inválido, ou usuário que não vende), 404 (usuário inexistente ou de outra empresa).
- Alterar o percentual vale só para vendas **futuras**. Avisar isso na tela.

## Pagamento da comissão ao vendedor (migration `062`)

**Liberada** = o direito foi confirmado pelo pagamento do cliente. **Paga** = a empresa pagou o vendedor e registrou. Não confundir com **repasse**, que é o vendedor repassando à empresa o dinheiro da venda.

A pagar de uma comissão = `valor_liberado` − soma dos itens de pagamento. Positivo = falta pagar; **negativo = a comissão foi paga e depois estornada** (venda cancelada ou pagamento estornado): vira **desconto no próximo pagamento** do vendedor.

| Rota | Quem | O que faz |
|---|---|---|
| `GET /comissoes/a-pagar` | `gerir_financeiro` (admin tem) | Por vendedor: `a_pagar` (líquido), `bruto_a_pagar`, `descontos`, `quantidade_comissoes`; `totais.a_pagar`. Só quem tem saldo diferente de zero. |
| `POST /comissoes/pagamentos` | `gerir_financeiro` (admin tem) | `{ vendedor_id, valor_esperado, forma, pago_em, observacao? }`. Paga **todo** o líquido do vendedor. |
| `GET /comissoes/pagamentos?vendedor_id=&page=&pageSize=` | quem tem `ver_vendas_de_todos` ou `gerir_financeiro`: todos; vendedor: só os seus | Histórico com as vendas cobertas (`itens`: `comissao_id`, `venda_id`, `valor`, negativo = desconto). |

Regras do `POST`: `forma` ∈ `pix`, `transferencia`, `dinheiro`, `outro`; `pago_em` AAAA-MM-DD, não futuro; **ninguém paga a própria comissão** (403); vendedor de outra empresa = 404. `valor_esperado` é o líquido que a tela mostrou: se mudou (estorno, nova liberação, outro pagamento simultâneo) = **409** e nada é gravado. Líquido ≤ 0 (descontos cobrem o liberado) = 409. As comissões do vendedor são travadas (`FOR UPDATE`, por id) e o "já pago" é lido **depois** da trava, em consulta separada, para que dois pagamentos simultâneos não paguem em dobro. Tabelas `comissao_pagamentos` e `comissao_pagamento_itens` são imutáveis no banco (UPDATE/DELETE recusados) e têm FKs compostas com `empresa_id`.

`GET /comissoes/minhas` ganha `valor_pago` por linha e `total_pago` / `a_receber` nos totais; `GET /comissoes/equipe` ganha `total_pago` / `a_pagar` por vendedor e nos totais (nos dois, sobre as comissões do período). Sem custo, margem ou lucro.

## Integração no frontend existente (verificado no código atual)

- `src/config/access.js`: registrar `'/comissoes'` em `ALLOWED_ROLES_BY_PATH` com `['admin', 'vendedor']`. O gerente tem `user.role === 'vendedor'` (perfil legado).
- `src/App.jsx` **lança erro ao carregar** se uma rota está em `access.js` e não em `ROUTE_COMPONENTS` (e vice-versa): registrar nos dois.
- `src/components/Sidebar.jsx`: incluir a rota em `NAV_META_BY_PATH` (ícone, rótulo, seção). Sem a entrada o item de menu sai quebrado. Opcional: item em `src/pages/Mais.jsx` para o menu mobile.
- Uma única página `/comissoes` com abas conforme o perfil:
  - **Minhas comissões**: todos que acessam a página.
  - **Equipe**: só se `useAuth().temCapacidade('ver_vendas_de_todos')` (admin passa).
  - **Repasses**: o vendedor vê o saldo `dinheiro_a_repassar` e a lista dele; quem tem `ver_vendas_de_todos` vê a fila da empresa e confirma.
  - **Percentuais**: só se `user.role === 'admin'` (o backend usa `role === 'admin'`).
  - Detalhe da comissão: linha do tempo com `GET /comissoes/:id/historico`.
- Estados obrigatórios: carregando, vazio ("nenhuma comissão no período"), erro (mostrar `message` do backend sem mascarar). `estornada` deve se diferenciar por **texto/ícone**, não só por cor.
- Filtro de período com padrão no mês atual; enviar `YYYY-MM-DD`.

## Atenção: o cargo Gerente precisa ser ligado

O cargo `gerente` já existe no catálogo, mas vem **desligado por padrão** em cada empresa. O frontend atual **não tem tela de cargos**: `'/configuracoes/cargos'` aparece em `access.js` só como regra de capacidade, sem página, e não há serviço de cargos. Enquanto não existir a tela, ligar o cargo é via API (`GET /cargos`, `PUT /cargos/:cargo`, exige `gerir_cargos`; admin tem todas). Sem isso, nenhum usuário consegue ser gerente e a aba **Equipe** só aparece para o admin.

## O que não existe (fora do escopo desta entrega)

- Pagamento automático (Pix/transferência feita pelo sistema): o sistema **registra** o pagamento feito pela empresa (ver "Pagamento da comissão ao vendedor"), mas não move dinheiro.
- Comissão de vendas anteriores à ativação.
- Percentual por categoria ou meta escalonada.
- Recebimento de parcela de crediário pela rota `PATCH /contas-receber/:id/receber` em venda do fluxo novo (`pagamentos[]`): a comissão acompanha o recebimento da **parcela** (`PATCH /parcelas/:id/receber`). Venda legada acompanha a conta a receber.

## Cargo financeiro e capacidade `gerir_financeiro` (migration 063)

- Nova capacidade `gerir_financeiro`: confirmar repasse de dinheiro, ver o "a pagar" e registrar pagamento de comissão. Não dá acesso a custo, margem nem a configurações.
- Novo cargo funcional `financeiro` (rótulo **Analista financeiro**; fora da escada, sem nível, perfil base = vendedor), **desligado por padrão** em cada empresa. Padrão: `ver_vendas_de_todos` + `gerir_financeiro`.
- Sem o cargo desenhado, o financeiro fica com quem já tem a capacidade por padrão: **Diretor, Gerente e Admin**. Coordenador e Supervisor **não** têm (mudança: antes confirmavam repasse com `ver_vendas_de_todos`); a empresa pode concedê-la em `PUT /cargos/:cargo`.
- Empresas que já editaram Diretor/Gerente (capacidades explícitas) recebem `gerir_financeiro` na migration, se o cargo tem `ver_vendas_de_todos`, para ninguém perder o que já fazia.
