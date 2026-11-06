# Planos públicos (site da GiroNex)

`GET /publico/planos`, sem login, com o mesmo teto por IP das outras rotas públicas e `Cache-Control: public, max-age=300`.

## O que devolve

- `planos`: só os marcados em `planos_comerciais.exibir_no_site` (migration 093: Básico, Padrão e Pro). Cada um traz `codigo`, `nome` (Semente, Cultivo, Pomar), `nome_joias` (Pérola, Esmeralda, Safira), `limite_usuarios` (null = sem limite), `tem_mensalidade`, `percentual_pix` (política vigente, texto) e `funcionalidades` (códigos incluídos).
- `funcionalidades`: catálogo (`codigo`, `nome`, `tipo`, `vendavel`). `vendavel: false` = "em breve".

## O que NÃO devolve

- Preço de mensalidade: o backend só publica o que ele mesmo aplica. O valor de lançamento é do site (hipótese até validar; ver especificação).
- Cortesia, planos legados, qualquer id interno ou dado de empresa. Plano novo só aparece com `exibir_no_site = true` por migration.

## Operação

- CORS: as origens do site vão na variável `SITE_CORS_ORIGINS` do backend (Render, passo do Eduardo), separadas por vírgula e sem barra no final, ex.: `https://www.vertumno.com.br,https://vertumno.com.br`. Somam-se a `CORS_ORIGINS` (ERP) e `PAINEL_CORS_ORIGINS`, que não mudam. A comparação é exata: esquema, host e `www` contam. Sem a origem na lista, o navegador não consegue ler a rota.
- Os dados mudam só por migration; o cache curto basta.
