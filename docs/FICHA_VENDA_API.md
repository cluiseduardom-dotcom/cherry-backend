# Ficha de venda do SKU — contrato (#150, fatia 1a)

Migration `067_fichas_venda.sql` (`fichas_venda`, `itens_ficha_venda`). **Não é a ficha técnica de produção**
(`/produtos/:id/ficha-tecnica`, migration 013): aquela transforma insumos em produto acabado; esta descreve o que acompanha
**uma unidade vendida** (embalagem, tag, caixinha...) e dá o **custo total do SKU**. A baixa automática na venda, o snapshot por
venda e a pendência de insumo faltando vêm na fatia 1b; o consumo avulso e a tela de Consumo, na 1c.

## Rotas (admin e estoquista; vendedor = 403)
- `POST /produtos/:id/ficha-venda` — `{ "itens": [{ "insumo_produto_id": 12, "quantidade": 1 }] }`. Cria uma **nova versão vigente**
  (a anterior vira não vigente na mesma transação; nunca há UPDATE). `itens` pode ser `[]` ("este SKU não leva nada"). Máx. 50 itens.
- `GET /produtos/:id/ficha-venda` — ficha vigente. Produto sem ficha devolve `id: null`, `itens: []` e o custo só do item.
- `GET /produtos/:id/ficha-venda/historico` — todas as versões, da mais recente para a mais antiga.

## Resposta
`{ id, produto_id, vigente, criado_por, criado_em, itens: [{ id, insumo_produto_id, insumo_nome, insumo_sku, quantidade, custo_unitario, subtotal_custo }], custo_item, custo_insumos, custo_total_sku }`.
`custo_total_sku = custo do item + Σ(quantidade × custo unitário do insumo)`, em centavos inteiros (sem erro de ponto flutuante).
O custo usa o **custo atual** dos insumos (o snapshot por venda congela o valor: `venda_consumos.custo_unitario`).

## Regras
- Produto da ficha: `tipo = 'acabado'`. Itens: `tipo = 'insumo'`, **ativos**, da mesma empresa. `quantidade` inteira, 1 a 1000, sem repetir insumo.
- Produto/insumo de outra empresa → 404; tipo errado ou insumo inativo → 400.
- Trava `FOR UPDATE` no produto serializa edições concorrentes da mesma ficha.

## Multi-tenant / RBAC
- `empresa_id` só do JWT; FKs compostas `(id, empresa_id)` no banco recusam mistura entre empresas mesmo por SQL direto.
- Valores de custo só vão para quem tem a capacidade `ver_custos` (mesma regra da ficha técnica); sem ela, a composição vem sem nenhum valor.
