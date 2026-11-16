# Resultado (lucro) de vendas

Mostra quanto cada venda, um período ou um mês rendeu: receita, custo, lucro bruto, lucro líquido e a % sobre a receita.

## Definições (únicas para venda, lista e período)

| Campo | Cálculo |
|---|---|
| `receita` | `subtotal − desconto`. Juros do crediário **não** entram (mesma base da comissão). |
| `custo` | `Σ quantidade × custo_unitario` congelado no item da venda (não o custo atual do produto). |
| `lucro_bruto` | `receita − custo` |
| `comissao` | comissão do vendedor apurada na venda (`comissoes_venda`); `estornada` não conta |
| `impostos` | `receita × aliquota_imposto` da empresa (`configuracoes_financeiras`, a mesma do Ponto de Equilíbrio) |
| `lucro_liquido` | `lucro_bruto − comissao − impostos` |
| `margem_*_pct` | `lucro / receita × 100`, 2 casas. `null` quando a receita é 0 |

No período há ainda, só quando permitido (abaixo): `despesas_fixas` (despesas fixas ativas rateadas pelos dias do período),
`lucro_apos_despesas_fixas = lucro_liquido − despesas_fixas` e `margem_apos_despesas_fixas_pct`.

Por venda o `lucro_liquido` **não** inclui despesas fixas (`inclui_despesas_fixas: false`): despesa fixa não pertence a uma venda.

Só entram vendas `finalizada` (cancelada não tem resultado: `resultado: null`). O dia é o de São Paulo.
Taxa interna da plataforma (`taxas_venda`) nunca entra: é cobrança da GiroNex e não aparece na API de vendas.

## Endpoints

- `GET /vendas/:id` e `GET /vendas` — cada venda ganha `resultado` (objeto acima + `inclui_despesas_fixas`), **só** para quem tem a capacidade `ver_custos`. Vendedor e cargos sem `ver_custos` não recebem o campo.
- `GET /vendas/resultado?data_de=YYYY-MM-DD&data_ate=YYYY-MM-DD[&agrupar=dia|mes]`
  - Exige `ver_custos` **e** `ver_vendas_de_todos` (403 se faltar uma).
  - Resposta: `{ periodo, totais, sem_despesas_fixas, serie? }`. `serie` (com `agrupar`) traz um item por dia (`dia`) ou mês (`mes`, `YYYY-MM`), inclusive os sem venda (carregam a despesa fixa do balde).
  - Limites: período até 731 dias; `agrupar=dia` até 93 dias. Datas inválidas ou fora de ordem: 400.
  - Despesas fixas (`despesas_fixas`, `lucro_apos_despesas_fixas`, `margem_apos_despesas_fixas_pct`) só para **admin** com a funcionalidade `analise_financeira` ligada (mesma regra da rota `/despesas-fixas`); para os demais vêm `null`.

## Multi-tenant e RBAC

`empresa_id` sempre do JWT; toda consulta filtra por `empresa_id` (vendas, itens, comissões, despesas, alíquota).

## Limitações conhecidas

- Imposto é uma alíquota única sobre a receita (não distingue produto/regime).
- Não há taxa de maquininha/cartão cadastrada: não é abatida.
- Impostos do período são calculados sobre a receita total; a soma dos impostos arredondados venda a venda pode diferir em centavos.
- Receita por competência (data da venda): venda a prazo conta no mês em que foi feita, mesmo recebida depois.
