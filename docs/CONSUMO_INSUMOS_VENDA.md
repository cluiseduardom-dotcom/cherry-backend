# Consumo automático de insumos na venda (#150, fatia 1b)

Sem rota nova: acontece dentro de `POST /vendas` e `PATCH /vendas/:id/cancelar`. A composição vem da **ficha de venda**
vigente de cada produto vendido (`docs/FICHA_VENDA_API.md`).

## Na venda (mesma transação)
1. Lê as fichas vigentes dos produtos vendidos e trava produtos **e** insumos juntos, em ordem de id (evita deadlock).
2. Para cada insumo: `previsto = Σ(quantidade vendida × quantidade da ficha)`; baixa `min(previsto, saldo do Central)`.
3. Grava uma linha em `venda_consumos` por (venda, insumo, ficha): `quantidade_prevista`, `quantidade_baixada`,
   `custo_unitario` (custo do insumo na hora), `local_id` (Central), `origem = 'ficha'`.
4. A saída é uma movimentação `saida` com motivo `Consumo venda #N` (histórico de estoque).

- Insumo **só sai do Central**, de qualquer local de onde saiu o produto vendido (decisão do PO).
- **Falta de saldo não bloqueia a venda**: `quantidade_baixada < quantidade_prevista` é a **pendência**. Estoque nunca fica negativo.
- Mudar a ficha depois não altera vendas antigas (snapshot). A resposta de `/vendas` não muda.

## No cancelamento
O baixado volta ao Central (`entrada`, motivo `Devolução consumo venda #N`) e as linhas recebem `devolvido_em`.
Pendências da venda cancelada deixam de existir para o sino. Nada é apagado.

## Sino
`insumo_pendente` (alta), admin e estoquista: uma linha por insumo com `quantidade_pendente` e `vendas`. Sem custo/margem/lucro.

## Multi-tenant
`empresa_id` do JWT; FKs compostas `(id, empresa_id)` para venda, insumo, ficha e local; consultas sempre filtradas por empresa.

## Fora desta fatia (1c)
Consumo avulso, retirar/acrescentar por venda, substituição em lote, motivos `brinde`/`substituicao`/`outro`,
regularizar pendência, tela de Consumo e relatórios de consumo/custo. O custo da venda por consumo real entra nos relatórios.
