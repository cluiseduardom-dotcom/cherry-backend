# Relatórios de gestão

Somente leitura, sempre da empresa do JWT (`empresa_id` nunca vem da query). Código: `src/routes/relatorios.js`,
`src/services/relatoriosService.js`, `src/repositories/relatoriosRepository.js`, regras puras em `src/utils/relatorios.js`.
Sem migration.

## Regras comuns
- **Dia** é o de São Paulo (`docs/DATAS_FUSO.md`). Período: `data_de` e `data_ate` (`YYYY-MM-DD`, inclusivos), no máximo 731 dias.
- **Receita da venda** = `subtotal − desconto` (juros do crediário não entram). **Custo** = custo congelado no item vendido.
  Mesmas definições de `docs/RESULTADO_VENDAS_API.md`. Só vendas `finalizada` entram; cancelada aparece à parte.
- **Custo, lucro e margem** só saem para quem tem `ver_custos`. Para os demais o campo é **omitido** (nunca vem zerado).
- Percentuais com 2 casas; sem base de cálculo (divisão por zero) o valor é `null`, nunca `NaN`/`Infinity`.
- Cliente anonimizado (LGPD) aparece como "Cliente anonimizado".

## Rotas

| Rota | Quem acessa | O que devolve |
|---|---|---|
| `GET /relatorios/vendas?data_de&data_ate` | `ver_vendas_de_todos` | totais (vendas, receita, ticket médio, itens, desconto, juros; + custo/lucro/margem com `ver_custos`), **comparativo** com o período anterior de mesmo tamanho, canceladas, por canal (com participação), por forma de pagamento, por dia da semana (0 = domingo, 7 linhas), top 10 clientes |
| `GET /relatorios/desempenho?data_de&data_ate` | `ver_vendas_de_todos` | ranking de vendedores por receita: vendas, participação, ticket médio, itens por venda, comissão (estornada não conta), canceladas (+ custo/lucro/margem com `ver_custos`) |
| `GET /relatorios/produtos?data_de&data_ate&ordem&limite` | `ver_vendas_de_todos` | produtos vendidos com quantidade, receita, **curva ABC** (A até 80% da receita acumulada, B até 95%), **cobertura em dias** (estoque ÷ ritmo de venda do período), última venda; **capital parado** (produtos ativos, com estoque, sem venda no período). `ordem`: `receita` (padrão), `quantidade` ou `margem` (sem `ver_custos` cai para `receita`); `limite` 1–200 (padrão 50) |
| `GET /relatorios/inventario?local_id&tipo&somente_com_saldo&page&pageSize` | admin e estoquista | posição de estoque por produto (saldo total, ou saldo de um local com `local_id`), abaixo do mínimo, resumo por local; valor em custo para quem pode ver custo operacional (admin, estoquista, `ver_custos`). `tipo`: `produto` (padrão) ou `insumo`; `somente_com_saldo` padrão `true`; produto inativo com saldo continua listado |
| `GET /relatorios/credito?data_ref` | `gerir_financeiro` **e** `ver_todos_clientes` | contas a receber em aberto (restante já descontando recebimento parcial), vencido × a vencer, inadimplência %, **aging** (a vencer, 1–30, 31–60, 61–90, 90+ dias), top 20 clientes. O bloco de **fiado** só aparece se a empresa tem a funcionalidade `fiado`. `data_ref` padrão = hoje (SP) |

Erros: `400` parâmetro inválido (mensagem em português), `401` sem sessão, `403` sem permissão, `404` local de estoque de outra empresa ou inexistente.

## Limitações conhecidas
- Receita por produto = quantidade × preço de tabela do item; **o desconto da venda não é rateado por item** (a soma por produto pode passar da receita da venda com desconto).
- Cobertura usa a média do período escolhido; produto sazonal pede período maior.
- "Por forma de pagamento" soma o valor lançado em `pagamentos_venda` (estornado fora); venda no crediário aparece como `crediario`, não como recebida.
- Crédito não projeta recebimentos futuros nem separa parcelas de uma mesma venda.
- Sem exportação (CSV/PDF) nesta etapa.
