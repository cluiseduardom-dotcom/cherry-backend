# Cortesia: expiração automática

Decisão do PO (05/11/2026): a Cortesia acaba automaticamente no 3º mês de uso; o plano é escolhido na negociação com o cliente.

## Como funciona

- `POST /painel/empresas/:id/plano` com `plano: "cortesia"` grava a Cortesia com `vigencia_fim` = início + 3 meses de calendário − 1 dia, **e** um registro sucessor do plano Básico começando no dia seguinte, sem fim (`empresa_planos.sucessor_automatico = true`, migration 091).
- Nenhuma resolução de plano muda (sessão, taxa, limite de usuários): depois do fim da Cortesia, o plano vigente passa a ser o Básico (5 usuários, nenhuma funcionalidade avulsa, 0,50% sobre o Pix, sem mensalidade cobrada até o billing existir). A empresa nunca cai em silêncio no padrão `sem_mensalidade` (sem limite).
- Quando a negociação fecha, a GiroNex atribui o plano escolhido pelo Painel. O sucessor automático ainda não vigente é desativado (nunca apagado; motivo gravado em `motivo_encerramento`) e não conta como "plano agendado". Se ele já estiver vigente, a troca segue o fluxo normal.
- Plano agendado manualmente continua barrando nova troca (409).
- `GET /painel/empresas` e o histórico passam a expor `sucessor_automatico` para o Painel avisar quem está perto do fim.

## Limites

- Empresas que já estão em Cortesia hoje (nenhuma em produção) não ganham sucessor retroativo; a GiroNex reatribui o plano se necessário.
- O aviso "Cortesia termina em N dias" é do Painel (próximo PR, gironex-painel).
- O fim da Cortesia não cobra nada: a cobrança do Básico depende do billing (slice 4).
