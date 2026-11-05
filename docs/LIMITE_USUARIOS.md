# Limite de usuários por plano

Slice 2 do desenho de planos (PO, 05/11/2026). O backend é a fronteira; o frontend só explica.

## Regra

- Conta como usuário todo `usuarios.ativo = true` da empresa, qualquer cargo (o admin conta).
- Limite efetivo = `planos_comerciais.limite_usuarios` + `empresa_limites_usuarios.usuarios_extras`.
- `limite_usuarios` NULL no plano, ou `ilimitado = true` na empresa, = sem limite.
- Plano da empresa resolvido como na sessão (vigente; sem plano vale `sem_mensalidade`).
- Seed: Cortesia 3, Básico 3, Padrão 7, Pro 15, `sem_mensalidade` e `com_mensalidade` sem limite.
- Cherry e Valvazori: sem plano com limite hoje (caem em `sem_mensalidade`); ao receberem plano, registrar `ilimitado = true` antes.

## Onde é aplicado

- `POST /usuarios` (`usuariosRepository.criarComAuditoria`) e `PATCH /usuarios/:id/bloqueio` ao desbloquear.
- Dentro da transação, com `SELECT ... FROM empresas FOR UPDATE` e contagem sob essa trava: criações e desbloqueios simultâneos não furam o limite.
- Excedido: `409 "Limite de N usuários ativos do seu plano atingido. Fale com a GiroNex para ampliar."`
- Bloquear usuário nunca é barrado. Quem já excede o limite (plano rebaixado) não perde ninguém; só não entra novo.

## Pendências

- Painel: endpoint e tela para definir extras/ilimitado, com trilha em `plataforma_eventos` (próximo PR).
- Expiração automática da Cortesia no 3º mês de uso (próximo PR, depende de definir o que acontece no vencimento).
- Usuário extra hoje é só registro; a cobrança entra com o billing.
