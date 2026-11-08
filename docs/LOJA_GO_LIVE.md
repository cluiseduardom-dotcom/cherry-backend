# Loja online — go-live e primeiro pagamento real

Roteiro para quem aplica em produção (Product Owner). Nada aqui é executado automaticamente.

## 1. Ordem
1. **Staging primeiro** (branch isolada do Neon): aplicar as migrations `095` a `098`, nessa ordem, e rodar a verificação abaixo. Só depois produção.
2. Deploy do backend (o runner aplica as migrations pendentes no `npm start`).
3. Variáveis na API: `LOJA_CORS_ORIGINS` (endereço exato da loja, sem `*`), `LOJA_PUBLIC_URL` (https), `TURNSTILE_SECRET_KEY`, `R2_PUBLIC_BASE_URL` e as `MP_*` já existentes.
4. Cron Job do Render, a cada minuto: `node scripts/expirar-reservas-loja.js`.
5. Ligar `loja_online` para a Cherry no Painel; marcar os produtos como visíveis; garantir preço no canal `online`.
6. Loja: variáveis `VITE_*` antes do build e regra de reescrita `/*` → `/index.html`.

## 2. Verificação de prontidão (somente leitura)
```bash
node scripts/preflight-loja.js <slug-da-empresa>
```
Só faz `SELECT`. Mostra se cada variável está definida (nunca o valor), se as migrations chegam à 098, se a empresa está ativa com `loja_online` ligada, se há canal `online`, Mercado Pago conectado, produtos visíveis com preço e se há reserva vencida parada (sinal de que o Cron não roda). Sai com código 1 se houver item bloqueante.
Não prova: a assinatura real do webhook, o widget Turnstile no navegador e o frete.

## 3. Primeiro pagamento real (feito por você)
Objetivo: provar o caminho completo com dinheiro real, uma vez, antes de divulgar.

1. Na loja, escolha a peça mais barata, com **Pix**, e preencha seus próprios dados (nome, e-mail, telefone).
2. Crie o pedido e pague o QR no app do banco. Anote o código do pedido.
3. Esperado, em até ~1 minuto: a página do pedido vira **pago**; no ERP surge o aviso "Pedido pago na loja online" e o pedido em **Pedidos da loja → A combinar**; existe a venda correspondente (origem gateway) e o estoque saiu da Reserva.
4. Se a página **não** virar paga de imediato: o webhook pode estar sendo recusado (assinatura). No painel do Mercado Pago, em Webhooks / notificações, veja o status das entregas: `401` = assinatura não confere. **Mesmo assim o Cron reconsulta o Mercado Pago e confirma o pagamento em ~1 minuto**; então o pedido ainda fecha, mas o webhook precisa ser corrigido (conferir `MP_WEBHOOK_SECRET` e a URL cadastrada).
5. Se passar de ~5 minutos com cobrança paga e sem venda, o sino mostra "Pagamento recebido sem venda" (alta prioridade). Não refaça o pagamento: avise antes.
6. Clique **Entrega combinada** no pedido de teste (valida a fila).
7. Estorne o próprio pagamento pelo painel do Mercado Pago, se não for ficar com a peça. A venda de teste continua no histórico (por regra, nada é apagado): cancele-a pelo fluxo normal de cancelamento de venda do ERP, ou mantenha como venda real se a peça for sua.

### Pagamento que chega depois do prazo
Se a reserva venceu e a peça já não está no Central, o sistema **não vende**: a cobrança paga aparece em `GET /pagamentos-gateway/a-devolver` para o financeiro estornar (Pix e cartão, pelo painel do Mercado Pago).

## 4. Não verificado
- Assinatura do webhook com evento real (este roteiro é a prova).
- Widget Turnstile no navegador (backend testado; storefront não).
- Frete: provisório "a combinar"; trocar por Melhor Envio antes de divulgar.
