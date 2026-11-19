# Cobrança por empresa: teste grátis, pagamento manual, isenção e somente leitura

Decisão do PO (19/11/2026): o cliente escolhe o plano e usa tudo normalmente por 30 dias grátis (a taxa do Pix já vale desde o dia 1);
depois a cobrança liga no plano escolhido. A cobrança é **manual** (a GiroNex recebe por fora e registra no Painel); não há billing
automático. Vencido e sem pagamento, a empresa vira **somente leitura**; a GiroNex pode **desligar** manualmente.
A GiroNex também escolhe quem **não paga** (família, parceiros), sem depender do plano.

## Situações (derivadas das datas, nunca gravadas)
Regra única em `src/repositories/cobrancaSituacaoSql.js`, usada pela sessão e pelo Painel. "Hoje" = dia de São Paulo.

| Situação | Quando | Efeito no ERP |
|---|---|---|
| `isenta` | `empresa_cobranca.isenta = true` | uso normal, para sempre, até a GiroNex remover |
| `em_teste` | `hoje <= trial_fim` | uso normal |
| `ativa` | `hoje <= pago_ate` | uso normal |
| `somente_leitura` | nenhuma das anteriores | consulta e exporta; não grava |
| `sem_regra` | empresa sem linha na tabela (as que já existiam) | **sem restrição**, como antes |

Precedência: isenta, depois em_teste, depois ativa, senão somente_leitura.

## Somente leitura (`authMiddleware`)
Barra `POST`, `PUT`, `PATCH` e `DELETE` com **403**. Continuam liberados: todo `GET/HEAD/OPTIONS`, `POST /auth/renovar` e `POST /auth/senha`
(a sessão não morre). Webhooks do Mercado Pago não têm sessão de loja e seguem funcionando. Nada é apagado.
`GET /auth/me` devolve `cobranca: { situacao, ate } | null` para o frontend avisar (o servidor é quem barra de fato).

## Desligar e religar
Usa `empresas.status` (`ativa` ↔ `inativa`, já existente): derruba login e tokens na hora; os dados ficam; religar devolve o acesso.
A loja online da empresa também sai do ar enquanto estiver desligada. Não é exclusão.

## Rotas do Painel (`/painel`, sessão do painel com 2FA; empresa-alvo vem da rota)
Todas as ações pedem `justificativa` (mín. 3 caracteres); responsável e operador vêm da sessão. Cada uma grava `plataforma_eventos` na
mesma transação, com `situacao_antes` e `situacao_depois`.

| Rota | Efeito |
|---|---|
| `GET /empresas/:id/cobranca` | situação atual, datas, isenção, status da empresa |
| `POST /empresas/:id/cobranca/teste` | começa o teste hoje: `trial_fim = hoje + dias - 1` (`dias` opcional, 1 a 90, padrão 30). **Uma vez por empresa** (409 se repetir) |
| `POST /empresas/:id/cobranca/pagamento` | `{ pago_ate }`: de hoje a 400 dias à frente. 409 se isenta |
| `POST /empresas/:id/cobranca/isencao` | isenta a empresa. 409 se já isenta |
| `POST /empresas/:id/cobranca/isencao/remover` | volta à regra das datas (pode cair em somente leitura na hora; o retorno mostra a situação) |
| `POST /empresas/:id/desligar` / `religar` | `empresas.status` |

O **plano** continua sendo atribuído por `POST /empresas/:id/plano` (antes de iniciar o teste); o teste não muda plano nem taxa.
`GET /empresas/comercial` traz `cobranca: { situacao, ate }` por empresa.

## Limites e pendências
- Não há cobrança automática nem aviso por e-mail: o Painel precisa mostrar "teste termina em N dias" e "vencidos".
- O frontend do ERP ainda precisa exibir o aviso de teste e o modo somente leitura a partir de `cobranca` em `/auth/me`.
- A Cortesia (3 meses, depois Básico) continua existindo; com o teste grátis ela fica redundante para novos cadastros (decisão do PO).
- Taxa do Pix e limites do plano valem durante o teste, sem exceção.
