# Datas de negócio e fuso horário

O servidor (Render) e o banco (Neon, `TimeZone = GMT`) rodam em **UTC**. A empresa trabalha em **America/Sao_Paulo (UTC−3)**. Entre 21h e 23h59 de Brasília, o servidor já está no dia seguinte. Toda regra que depende de "que dia é hoje" ou "em que dia aconteceu" usa o dia de São Paulo.

## O que o erro causava (corrigido)
- Conta que **vence hoje** aparecia **atrasada** a partir das 21h.
- Recebimento, pagamento e parcela à vista saíam com a **data de amanhã**; vencimento do crediário calculado a partir do dia errado.
- Na **virada do mês**, uma venda das 22h de 30/11 (gravada como 01h de 01/12 em UTC) caía em **dezembro** nos filtros de período e nos relatórios (vendas, comissões, taxa da plataforma, ponto de equilíbrio, movimentações de estoque, produções).
- Período padrão de fluxo de caixa e ponto de equilíbrio (do dia 1 até hoje) e datas padrão de cotação, usuários e comissões.

## Regras
1. **Nunca** usar `new Date().getDate()`/`getMonth()`, `toISOString().slice(0, 10)` nem `CURRENT_DATE` para decidir o dia de negócio.
2. Use `src/utils/dataSaoPaulo.js`:
   - `hojeSP()`, `inicioDoMesSP()`: dia de hoje e início do mês em São Paulo (`'YYYY-MM-DD'`).
   - `somarMeses(data, n)`, `somarDias(data, n)`: aritmética de calendário sobre texto, sem fuso (31/01 + 1 mês = 28/02).
   - `dataDoBanco(valor)`: coluna `DATE` do pg (que vem como `Date` à meia-noite local) de volta ao mesmo `'YYYY-MM-DD'`.
   - SQL: `SQL_HOJE_SP` no lugar de `CURRENT_DATE`; `sqlDiaSP('v.data')` no lugar de `v.data::date` para colunas **TIMESTAMP sem fuso** que guardam UTC (vendas, movimentações, produções).
3. Colunas `DATE` continuam texto `YYYY-MM-DD` de ponta a ponta (regra de `CLAUDE.md`).
4. **Não** mudar `process.env.TZ`: isso deslocaria em 3 horas os `TIMESTAMP` sem fuso, que guardam UTC.
5. Colunas `TIMESTAMPTZ` (movimentos bancários etc.) já usam `AT TIME ZONE 'America/Sao_Paulo'` e seguem assim.

## Verificação
- `tests/utils/dataSaoPaulo.test.js`: fronteiras (20h59, 21h30, 23h59, meia-noite, virada de mês e de ano), meses curtos e bissexto.
- `tests/services/contasAtrasoFusoSaoPaulo.test.js`: "atrasado" só depois do dia do vencimento, com relógio falso (passa com o processo em UTC ou em Brasília).
- `tests/routes/datasFusoSaoPaulo.integration.test.js`: venda das 22h de 30/11 conta em novembro (filtro de vendas e receita), a da meia-noite em dezembro; recebimento grava o dia de São Paulo.

## Fora desta correção
- Telas: já exibem data sem hora de forma segura (`formatarData`); datas "de hoje" do navegador usam o fuso do usuário.
- Padrões `DEFAULT CURRENT_DATE` de duas tabelas antigas (`recebimentos`, `ordens_compra`) não são usados: o código sempre informa a data.
- Não confirmei o fuso configurado no servidor do Render (se houver variável `TZ`, o comportamento antigo seria outro); o banco foi confirmado em GMT.
