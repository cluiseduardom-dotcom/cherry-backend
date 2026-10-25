# Clientes por usuário (migration 065)

Cada cliente tem um **responsável**: quem o cadastrou (`clientes.criado_por`, vem do JWT, nunca do corpo; o corpo com `criado_por`/`empresa_id` é recusado — 400).

## Quem vê o quê

| Quem | Vê |
|---|---|
| Tem a capacidade `ver_todos_clientes` (Admin; por padrão também Diretor, Gerente, Coordenador, Supervisor, Analista e Analista financeiro) | Todos os clientes da empresa, inclusive os **legados** (sem dono) |
| Não tem (Vendedor, Operador, Auxiliar, ou cargo que a empresa tirou a capacidade) | **Só os que cadastrou**. Cliente legado e cliente de outro usuário não aparecem |

A empresa pode conceder ou retirar `ver_todos_clientes` de um cargo em `PUT /cargos/:cargo` (Admin).

## Onde a regra vale (sempre no backend, junto com o filtro de `empresa_id`)
- `GET /clientes`, `GET /clientes/ranking`: só os do escopo.
- `PATCH /clientes/:id`, `GET /clientes/:id/total-gasto`, `GET /clientes/:id/historico`: cliente fora do escopo = **404**, nada é alterado.
- `POST /vendas` com `cliente_id`: fora do escopo = **404 "Cliente não encontrado"**, nenhuma venda criada. Venda sem cliente segue livre.
- `POST /clientes` grava `criado_por = usuário do JWT`; a resposta traz `criado_por`.
- `PATCH /clientes/:id/anonimizar` continua só admin.

## Legado e implantação
- Clientes anteriores à migration ficam com `criado_por = NULL`: só quem vê todos os enxerga. Vendedores **deixam de ver** os clientes antigos e passam a ver só os que cadastrarem.
- Para atribuir um cliente antigo a um vendedor é preciso ajustar `criado_por` (ainda não há tela/rota para isso).
- A migration dá `ver_todos_clientes` às linhas já existentes de `cargos_empresa` de Diretor, Gerente, Coordenador, Supervisor, Analista e Analista financeiro, para não mudar o que esses cargos já viam.

## Fora do escopo desta regra
Locais de estoque consignado mostram o nome do cliente vinculado (telas de equipe de estoque), e listas de vendas/contas a receber podem exibir o cliente de uma venda já feita.
