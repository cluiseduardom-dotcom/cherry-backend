# Venda por peso e volume (migration 128)

Para adega, lanchonete e confeitaria: queijo a R$ 45,00 o kg, suco a R$ 9,90 o litro.

## Modelo
- O **estoque segue inteiro** na unidade-base (G, ML). A tela digita kg/L e converte (como na ficha técnica).
- `produtos.preco_base_quantidade` (1, 100 ou 1000; padrão 1): o `preco_venda` vale para N unidades-base. Só G e ML aceitam N > 1
  (CHECK no banco e validação na API). Queijo a R$ 45/kg = `preco_venda 45`, `preco_base_quantidade 1000`.
- O preço por canal (`precos_produto.preco_venda`) usa a mesma base do produto.
- O item da venda **congela o preço por unidade-base** (`itens_venda.preco_unitario` agora `NUMERIC(14,6)`: R$ 0,045/g). Por isso relatórios
  que somam `quantidade × preco_unitario` (faturamento, lucro, curva ABC, dashboard) seguem corretos sem mudança.
- O total do item é arredondado ao centavo: `round(quantidade × preço_centavos ÷ N) / 100`. Com N = 1 a conta é exatamente a de antes.
  O subtotal da venda é a soma dos itens arredondados (pode diferir em centavos de somar `quantidade × preco_unitario` sem arredondar).

## Preço e margem
Custo é por unidade-base (R$ 0,03/g). Para markup, margem e "preço abaixo do custo" o custo é levado à base do preço (R$ 30/kg).

## Limites
- A **loja online não vende por peso**: produto com base > 1 não publica (409) e produto publicado não passa a ser granel (409).
- Fiado, comissão, devolução e cancelamento usam o item congelado e não mudam.
- Sem balança integrada nem leitura de etiqueta de peso: o operador digita o peso.
