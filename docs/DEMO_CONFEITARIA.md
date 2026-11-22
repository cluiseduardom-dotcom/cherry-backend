# Demonstração: confeitaria com PCP

Cria uma empresa nova, **"Emilly Candy Designer"**, só para ver o sistema funcionando com PCP ligado. Não toca em nenhuma outra empresa.
**Só para banco local/descartável** (o script recusa API ou banco remotos).

## Como rodar (no seu computador)
1. Banco local migrado: `npm run db:migrate` (com `DATABASE_URL` apontando para um Postgres local).
2. Servidor em modo dev (o `/onboarding` só abre sem segredo em dev): `NODE_ENV=development npm start`.
3. Em outro terminal: `npm run demo:confeitaria` (usa `API_URL`, padrão `http://localhost:3000`, e a mesma `DATABASE_URL`).
4. Frontend (no `cherry-frontend`): `VITE_API_URL=http://localhost:3000 npm run dev` e abra o endereço que ele mostrar.

Login (tela com a marca em `/c/emilly`): `emilly@candydesigner.demo` / `Confeitaria#2026` (mude com `DEMO_SENHA`). Para refazer a demo, use um banco novo (o script avisa se ela já existe).

## O que ele monta
- **Tema visual próprio** (verde-menta e rosa pastel, menu claro; migration 130 + tema `emilly` no frontend), só para a demonstração.
- Modelo de **confeitaria** aplicado (categorias Bolos, Tortas, Doces... × tamanhos; SKU como `DOC-UNI-001`).
- **PCP** e **Compras avançado** ligados (como a GiroNex faria).
- 10 **insumos** em g/ml/un com estoque (a manteiga é pouca de propósito: 400 g) e 2 fornecedores.
- 4 produtos com **receita** (ficha técnica com rendimento), preço e SKU; mais a **granola** vendida por kg (R$ 48/kg).
- 4 **ordens de produção**: brigadeiro concluída (196 boas, 4 perdidas); torta concluída **sem manteiga suficiente** (a baixa de 440 g fica
  pendente: "Insumo pendente"); bolo de pote planejado; brownie **atrasado** (aparece em Avisos).
- 4 vendas no caixa (inclui granola por peso: 350 g = R$ 16,80).

## O que olhar
Produção (ordens e fichas técnicas) · Avisos (insumo pendente, ordem atrasada) · Estoque de insumos · Produtos (SKUs) · Venda (granola por peso) ·
Compras > Cotações e Pedidos · Tutoriais. Para regularizar a manteiga: dê entrada (Compras) e use "Regularizar insumos" na ordem #2.
