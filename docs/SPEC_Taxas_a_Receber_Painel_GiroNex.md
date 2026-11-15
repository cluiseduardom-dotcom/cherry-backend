# SPEC — Taxas a receber (Painel GiroNex)

**Status:** v3 — todas as decisões fechadas pelo Product Owner em 15/11/2026; pronta para implementação
**Repositório alvo:** `gironex-painel` (e rotas internas no backend, sob `/interno/*`, fora das rotas de tenant)
**Relacionado:** ADR-007 (R4, R5, R6), decisões de 30/10/2026 (taxa só sobre Pix)

> Nota de implementação (backend): as rotas internas do painel já existem sob `/painel/*` (sessão própria,
> 2FA, trilha em `plataforma_eventos`; ver `docs/PAINEL_GIRONEX.md`). As rotas desta SPEC entram ali, não
> em um prefixo novo `/interno/*`. Onde a SPEC diz "plataforma_admin", leia "operador do painel": a marca
> `usuarios.plataforma_admin` foi removida pela migration 088.

## 1. Objetivo
Dar à GiroNex, para cada empresa e cada mês, o valor de taxa da plataforma **devido, retido, cobrado e recebido**, com origem auditável por venda. A parte retida no Mercado Pago não precisa de cobrança; o restante (Pix lançado manualmente e qualquer diferença) é cobrado manualmente.

## 2. Estado atual da tela (print de 15/11/2026)
Já existe: navegação por mês (horário de Brasília), cartões (Total a receber, Já retido no Mercado Pago, Vendas apuradas, Base das vendas), linha por loja (vendas, base, percentual, taxa a receber), exportação PDF e Excel, vendas canceladas fora do total, abatimento do que o Mercado Pago já reteve.
Exemplo conferido: base R$ 15,00 × 0,50% = 0,075 → R$ 0,08 (arredondado por venda); retido no MP R$ 0,08; a receber R$ 0,00.
**Não existe:** fechamento de período, status, lançamento de pagamento, ajuste/perdão, detalhe por venda, estorno após fechamento, extrato para envio, alertas de vencimento/atraso, divergência entre retido e calculado, trilha dos lançamentos desta tela, suspensão do Pix por atraso.
Preservar o que já funciona; implementar só o que falta.

## 3. Regras de negócio
- Taxa só sobre a parte paga em Pix (Mercado Pago ou manual). Dinheiro e cartão não pagam. Link de cartão 0% por ora.
- Percentual da condição vigente na data da venda; mudança nunca recalcula vendas feitas.
- Taxa congelada por venda em `taxas_venda`; nunca aparece na API de vendas, PDV, recibo ou documento fiscal (R6). Tela só do painel interno (R4).
- **Arredondamento por venda**, meio para cima, ao centavo; total do período = soma das taxas por venda. Em ticket pequeno a taxa efetiva fica acima da nominal (R$ 15,00 → 0,08 = 0,533%).
- **Fórmula:** a receber = Σ taxa por venda − Σ retido no Mercado Pago − pagamentos + ajustes.

## 4. Ciclo de cobrança
| Marco | Regra |
|---|---|
| Competência | Mês calendário, horário de Brasília |
| Fechamento | Dia 1 do mês seguinte: período congela e gera o extrato |
| Vencimento | **Dia 05** |
| Lembrete | Dia 4 (sugestão) |
| Carência | **15 dias após o vencimento** (até o dia 20). Valor configurável em um único lugar, compartilhado com a mensalidade |
| Aviso de suspensão | 5 dias antes do fim da carência (sugestão) |
| Suspensão | Ao fim da carência: **suspende o Pix da empresa** (Mercado Pago e manual). Dinheiro, cartão e o restante do sistema continuam. |
| Reativação | Automática ao registrar pagamento que leve o vencido abaixo do piso |
| Extrato | PDF gerado pelo painel + link de WhatsApp com mensagem pronta, enviado pelo operador. WhatsApp automático (API comercial) fica fora da v1 |
- Estados do período: Aberto → Fechado → Parcialmente pago → Pago. Atraso é calculado pela data, não é estado.
- A suspensão por taxa é independente da suspensão por mensalidade.

## 5. Regras
| # | Regra |
|---|---|
| T2 | Período fechado é imutável; correção = lançamento de ajuste no período seguinte. |
| T3 | Venda cancelada/devolvida gera estorno da taxa (lançamento negativo ligado à venda). Após fechamento, vira ajuste no período seguinte. |
| T4 | Pagamento da taxa é lançamento: data, valor, forma, comprovante opcional, responsável (usuário logado). Aceita parcial; maior que o saldo é rejeitado. |
| T5 | Perdão/desconto exige justificativa e responsável; aparece na Trilha. |
| T6 | Conciliação com o Mercado Pago: por venda Pix MP, comparar a taxa calculada com o valor retido. Diferença é sinalizada, não ignorada. |
| T7 | Pix manual: mostrar por empresa a proporção Pix MP × Pix manual e sinalizar fuga do padrão. **Ao sinalizar, bloquear o lançamento de Pix manual daquela empresa até revisão do admin.** Pix do Mercado Pago, dinheiro e cartão continuam. Desbloqueio é ação do admin com justificativa. |
| T8 | **Piso de cobrança R$ 10,00**: saldo vencido abaixo do piso acumula para o período seguinte e não aciona lembrete, aviso nem suspensão. Saldo que ficar abaixo do piso por 3 períodos consecutivos é cobrado mesmo assim, sem suspensão. |

## 6. Tela (alvo)
Filtros: empresa, competência, status. Cartões: devido, retido no MP, a receber, recebido, em atraso. Tabela por empresa com status e vencimento. Detalhe por venda (id, data, valor Pix, origem MP/manual, %, taxa, retido, situação). Ações (só plataforma_admin): fechar período, gerar extrato PDF, abrir WhatsApp com mensagem, registrar pagamento, ajuste, perdão, liberar Pix manual. Exportação PDF/Excel mantida. Todo lançamento na Trilha.

## 7. Dados (conceitual)
- `periodos_taxa` (empresa_id, competencia, status, total_calculado, total_retido_mp, fechado_em, fechado_por).
- `lancamentos_taxa` (periodo_id, tipo: pagamento|ajuste|perdao|estorno_venda, valor com sinal, venda_id opcional, justificativa, responsavel, criado_em). Append-only (gatilho recusa UPDATE/DELETE).
- Bloqueio de Pix da empresa: estado com motivo (suspensao_taxa | pix_manual_sinalizado), data e responsável da liberação; o backend de tenant consulta esse estado e recusa o Pix (a validação é no backend, nunca só no frontend).
- NUMERIC com 2 casas para valores; NUMERIC(7,4) para percentual.

> Implementado nas migrations `114_periodos_lancamentos_taxa.sql` (etapa 1) e `115_lancamentos_taxa_forma_comprovante.sql`. Convenção de sinal: `valor` é o
> efeito no saldo devido pela empresa; saldo do período = `total_calculado − total_retido_mp + Σ valor`.
> Pagamento, perdão e estorno de venda são negativos; ajuste é ± (nunca zero).
>
> Decisões do PO em 15/11/2026, complementares à v3:
> - Retido no MP maior que o calculado: **só sinaliza** (divergência T6); não vira crédito automático.
>   Correção, se houver, é ajuste ou perdão manual com justificativa.
> - Forma de pagamento em **lista fechada**: `pix`, `transferencia`, `boleto` (migration 115).
> - Comprovante armazenado no **S3** (`comprovante_chave` guarda a chave do objeto) (migration 115).
> - Pagamento/perdão **só em período fechado** (sem pagamento antecipado em período aberto).
> - Pendente: se o Mercado Pago devolve o `application_fee` quando o Pix é devolvido (define o estorno de
>   venda Pix MP após o fechamento).

## 8. Testes obrigatórios
- Pix MP e manual entram; dinheiro e cartão não.
- Percentual vigente na data; troca de exceção no meio do mês não altera vendas antigas.
- 15,00 × 0,50% = 0,08; soma de arredondamentos por venda confere com o total.
- Retido no MP abatido; divergência retido × calculado sinalizada.
- Cancelamento gera estorno; período fechado não muda (vira ajuste).
- Pagamento parcial; excedente rejeitado; UPDATE/DELETE em lançamentos recusado.
- Saldo abaixo do piso (R$ 10,00) não gera aviso/suspensão; 3 períodos seguidos abaixo do piso gera cobrança sem suspensão.
- Suspensão por atraso bloqueia Pix (MP e manual) no backend de tenant e não bloqueia dinheiro/cartão; pagamento reativa.
- Pix manual bloqueado por sinalização: lançamento recusado no backend; Pix MP segue.
- Usuário e JWT de tenant sem acesso às rotas do painel; taxa ausente nas respostas de /vendas.

## 9. Decisões registradas (15/11/2026)
| # | Decisão |
|---|---|
| D-T1 | Vencimento dia 05 (fechamento no dia 1) |
| D-T2 | Arredondamento por venda |
| D-T3 | Aviso e suspensão com a carência da mensalidade (15 dias) |
| D-T4 | Extrato por PDF e WhatsApp |
| D-T5/D-T6 | Pix manual: sinaliza e bloqueia o lançamento manual da empresa sinalizada |
| D-T7 | Suspensão por taxa atinge só o Pix |
| D-T8 | Piso R$ 10,00 (≈ R$ 2.000 de Pix manual a 0,50%) |
| D-T9 | Carência de 15 dias após o vencimento, valor único configurável |

## 10. Limitações
- Datas de lembrete e aviso são sugestão, não decisão.
- Valor do piso e regra dos 3 períodos são juízo de proporção, sem dado de volume real das lojas.
- Mecanismo de retenção do Mercado Pago não foi auditado; a conciliação (T6) assume valor retido por venda.
- Suspender o Pix pode levar o lojista a lançar como dinheiro; T7 mitiga, não elimina.
- WhatsApp automático exige API comercial; fora da v1.
