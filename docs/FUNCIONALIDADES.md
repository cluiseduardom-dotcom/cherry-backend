# Funcionalidades por plano e por empresa

Estado: **PR 2**. O bloqueio entra rota a rota; já bloqueadas: ver tabela abaixo.

| Funcionalidade | Rotas bloqueadas |
|---|---|
| `bancos` | todo `/bancos/*` |
| `analise_financeira` | `GET /financeiro/ponto-equilibrio`, todo `/despesas-fixas/*` |

A barreira de plano vem DEPOIS da de papel/capacidade (quem não tem o papel recebe o 403 de permissão). Pendentes: `maletas` e `comissoes` (PR 3).

## Regra

Uma funcionalidade está ligada para a empresa do JWT quando:

`(o plano ativo da empresa a inclui  OU  há ligação avulsa vigente com ligada = true)  E  NÃO há ligação vigente com ligada = false`

Desligar vence o plano e a ligação avulsa. Existe no máximo uma linha por (empresa, funcionalidade), então ligar e desligar não coexistem.

- **Plano ativo**: mesma regra de `taxasPlataformaRepository.buscarPlanoDaEmpresa` (ativo, vigente hoje em America/Sao_Paulo, mais recente primeiro; sem plano vale `sem_mensalidade`). Diferença deliberada: plano comercial inativo não derruba a sessão; um teste de integração compara os dois.
- **Vigência**: `vigencia_inicio <= hoje` e (`vigencia_fim` nula ou `>= hoje`), em America/Sao_Paulo. O último dia vale.
- **Núcleo do ERP não é funcionalidade**: PDV, produtos, clientes, estoque central, compras, contas a pagar/receber, Pix e cartão estão sempre ativos.

## Tabelas (migration 089)

| Tabela | Papel |
|---|---|
| `funcionalidades` | Catálogo fechado (só migration insere). `tipo` recurso ou modulo; `vendavel` falso = "em breve". |
| `plano_funcionalidades` | O que cada plano inclui. Global, sem `empresa_id` (como `planos_comerciais`). |
| `empresa_funcionalidades` | Ligação/desligamento por empresa. Tem `empresa_id`, justificativa, responsável e vigência. Administrada só pela GiroNex (Painel, PR futuro). |

Seed: planos `sem_mensalidade`, `com_mensalidade`, `padrao` e `pro` incluem os quatro recursos; `basico` e `cortesia` não incluem nenhum.

## Uso

```js
app.use('/bancos', authMiddleware, requireCapacidade(...), exigirFuncionalidade('bancos'), bancosRoutes);
```

Resposta quando não ligada: `403 "Funcionalidade não incluída no seu plano. Fale com a GiroNex."`, inclusive para admin. Sem usuário ou sem lista, nega.

## Pendências conhecidas

- O Painel deve impedir ligar funcionalidade com `vendavel = false` (PR 4).
- Cherry e Valvazori (exceções do PO: sem mensalidade, usuários ilimitados, acesso total, taxa Pix mantida) precisam de registro explícito antes de qualquer bloqueio ir para produção.
- `empresa_modulos` (053) e `exigirModulo` ficam como estão, sem uso; saem em migration própria depois.
