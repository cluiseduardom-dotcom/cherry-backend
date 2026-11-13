# Operação: monitoramento, backup, deploy e limites

Guia curto para quem opera o Vertumno em produção. Itens marcados **[CONFIRMAR]** dependem de algo que só aparece no painel do provedor (Render, Neon) e **não foi verificado pelo código**: confirme e preencha a data.

## 1. Monitoramento

O que existe no código:
- `GET /health`: o processo está de pé (não toca o banco).
- `GET /health/ready`: o processo está de pé **e** o banco responde (`SELECT 1`, limite de 3 s). Devolve `200 {"status":"ok"}` ou `503 {"status":"indisponivel"}`, sem detalhe de erro.
- Aviso no sino do ERP (admin e vendedor, com a loja online ligada): "Pagamento da loja sem venda" (cobrança paga que não virou venda há mais de 5 min), "Pedido da loja pago" (aguardando contato) e "Pagamento da loja estornado" (estornado no Mercado Pago com a venda ainda ativa).
- Rotina a cada minuto (`scripts/expirar-reservas-loja.js`): reconsulta pagamentos pendentes no Mercado Pago, converte pedidos pagos em venda e expira reservas. Cobre um webhook perdido.

O que **não** existe e precisa ser configurado fora do código:
1. **Monitor de uptime externo** (UptimeRobot, Better Stack ou similar, plano gratuito serve) em `https://<api>/health/ready`, a cada 1–5 min, com aviso por e-mail ou WhatsApp. [CONFIRMAR: criado em __/__/____]
2. **Alertas do Render** (falha de deploy e serviço reiniciando) para o e-mail do responsável. [CONFIRMAR]
3. **Coleta de erros (Sentry)**: implementada e **desligada por padrão**; só liga com a variável `SENTRY_DSN`.
   - O que é enviado: tipo e mensagem do erro (com e-mail, CPF, CNPJ, telefone, token e URL de banco **mascarados**), pilha de chamadas, versão (commit do Render), ambiente e duas etiquetas (rota em formato de modelo, como `/vendas/:id`, e método HTTP). **Não** é enviado: corpo, cabeçalhos, cookies, query string, usuário, IP nem logs.
   - O que dispara: só erro inesperado (5xx), falha ao subir o servidor e falha do cron das reservas da loja (o que cobre "pagamento pago que não virou venda por erro"). Erros de entrada do usuário (4xx) não são enviados.
   - Como ligar: criar uma conta e um projeto Node no Sentry; copiar o DSN; no Render, definir `SENTRY_DSN` nos serviços `cherry-backend` **e** `cherry-loja-cron` (e, se quiser, no staging); no Sentry, criar uma regra de alerta por e-mail para "novo erro". [CONFIRMAR: ligado em __/__/____]
   - Ao ligar, o provedor já consta na Política de privacidade da loja (seção "Com quem compartilhamos").
4. **Logs**: hoje são `console.*` no stdout do Render (retenção do plano do Render [CONFIRMAR]). Nunca registrar token, senha, DATABASE_URL nem dado de cartão.

Rotina semanal sugerida (5 minutos): abrir "Pagamentos a devolver" e o sino do ERP; conferir no painel do Mercado Pago as entregas de webhook (status 200; 401 repetido = assinatura divergente).

## 2. Backup e restauração

Fatos (fonte: documentação do Neon): a restauração por ponto no tempo ("instant restore") permite voltar o banco a um instante dentro da **janela de histórico**, que **depende do plano** (a documentação consultada cita 6 horas no plano gratuito e até 7 ou 30 dias em planos pagos; esses números mudam, confirme no painel). Fora da janela só existe cópia que **nós** fizermos. [Documentação: https://neon.com/docs/introduction/restore-window]

**[CONFIRMAR]** no painel do Neon: plano atual: ______; janela de histórico configurada: ______.

Regra mínima recomendada: janela de pelo menos 7 dias **e** uma cópia lógica independente do provedor, semanal.

### 2.1 Cópia lógica (independente do provedor)

```bash
# Em uma máquina de confiança, com pg_dump instalado. A URL vem do ambiente, nunca vai para arquivo nem para o chat.
export BACKUP_DATABASE_URL='<url direta de leitura do Neon>'
scripts/backup-logico.sh ./backups
```

O arquivo gerado tem dados pessoais e financeiros: guarde **criptografado** (ex.: `gpg -c`) e fora do repositório. Nunca commitar. Retenção sugerida: 4 semanas.

### 2.2 Teste de restauração (fazer uma vez e depois a cada trimestre)

Nunca restaurar sobre a produção para testar.
1. No Neon, crie um **branch** a partir de um instante recente (ou use o arquivo da cópia lógica em um banco vazio de teste).
2. Aponte uma instância de teste da API para esse branch (variáveis de staging) e confira: login, uma venda recente, o saldo de estoque de um produto, uma cobrança paga.
3. Anote data, tempo gasto e problemas encontrados no fim deste arquivo. Apague o branch de teste.

Restauração real (incidente): decidir o instante-alvo, restaurar em um branch novo, validar como acima e só então trocar o `DATABASE_URL` do serviço (ou promover o branch). Avisar os usuários, pois vendas feitas depois do instante-alvo se perdem.

Registro dos testes:
| Data | Quem | Origem (Neon/cópia) | Resultado | Tempo |
|---|---|---|---|---|
| | | | | |

## 3. Deploy e migrations

- `npm start` roda `node src/database/migrate.js && node src/server.js`: as migrations pendentes rodam antes de o servidor subir. Se uma migration falhar, o processo encerra com código 1 e **o servidor novo não sobe**; no Render o deploy é marcado como falho e a versão anterior continua atendendo [CONFIRMAR: comportamento do seu plano com health check configurado em `/health`].
- As migrations agora usam uma **trava no banco** (transação): dois processos subindo juntos não aplicam a mesma migration duas vezes.
- Para separar migrations do boot (recomendado quando houver mais de uma loja pagando): no Render, definir o **Pre-Deploy Command** como `npm run db:migrate` e o **Start Command** como `node src/server.js`. [Decisão do PO; recurso do Render depende do plano, CONFIRMAR]. Até lá, o comportamento atual continua válido.
- Migration nova: revisável e reversível (regra do projeto); só aplicada em produção pelo PO.

## 4. Limites conhecidos

- **Rate limit em memória** (`express-rate-limit` sem repositório compartilhado): vale por instância. Com **mais de uma instância** do backend, cada uma conta separado e o limite efetivo fica maior. Antes de escalar horizontalmente, trocar por repositório compartilhado (ex.: Redis). Hoje: 1 instância.
- **Sessão**: token de 8 h, sem renovação; a cada requisição o banco confere usuário ativo e revogação. Política de renovação/inatividade: pendente.
- **Listas paginadas**: o servidor entrega no máximo 100 produtos por página; telas que montam lista completa devem juntar as páginas (`listarTodosProdutos` no ERP). Produtos, Venda (PDV) e Detalhe da Compra ainda leem só a primeira página.
