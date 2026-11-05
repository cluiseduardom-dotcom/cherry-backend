# Planos públicos (site da GiroNex)

`GET /publico/planos`, sem login, com o mesmo teto por IP das outras rotas públicas e `Cache-Control: public, max-age=300`.

## O que devolve

- `planos`: só os marcados em `planos_comerciais.exibir_no_site` (migration 093: Básico, Padrão e Pro). Cada um traz `codigo`, `nome` (Semente, Cultivo, Pomar), `nome_joias` (Pérola, Esmeralda, Safira), `limite_usuarios` (null = sem limite), `tem_mensalidade`, `percentual_pix` (política vigente, texto) e `funcionalidades` (códigos incluídos).
- `funcionalidades`: catálogo (`codigo`, `nome`, `tipo`, `vendavel`). `vendavel: false` = "em breve".

## O que NÃO devolve

- Preço de mensalidade: o backend só publica o que ele mesmo aplica. O valor de lançamento é do site (hipótese até validar; ver especificação).
- Cortesia, planos legados, qualquer id interno ou dado de empresa. Plano novo só aparece com `exibir_no_site = true` por migration.

## Operação

- CORS: a origem do site precisa estar em `CORS_ORIGINS` do backend (variável no Render, passo do Eduardo) antes de o navegador consumir a rota.
- Os dados mudam só por migration; o cache curto basta.
