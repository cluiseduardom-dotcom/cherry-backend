# Meu Fiado dentro do Vertumno (GiroNex)

Estado: **proposta técnica para decisão do PO** (14/11/2026). Nenhum código foi escrito. Base: a especificação "Meu Fiado" (originalmente do micro SaaS independente) e o que o Vertumno **realmente tem hoje**. Onde a especificação dizia GiroOne, leia **GiroNex**.

## 1. Venda em vezes hoje: vai para Contas a pagar?
**Não. Vai para Contas a receber.** Contas a pagar é só o que a empresa deve (fornecedores, despesas).

Como funciona hoje (conferido no código, `vendasRepository`, `vendasValidation`):
- No PDV, a forma de pagamento **Crediário** exige **cliente identificado**. Você informa o número de parcelas e o prazo em meses.
- Cada parcela vira uma linha em **Contas a receber** (descrição "Venda #N - Parcela i/n") e uma parcela do pagamento.
- O vencimento da parcela *i* é `meses_prazo × i` meses a partir de hoje (**só intervalo mensal**).
- **Cartão de crédito parcelado** gera parcelas do pagamento, mas **não** cria linhas em Contas a receber (só o crediário cria).
- A baixa é por conta inteira: `marcarComoRecebida` só aceita conta pendente e a recebe **por completo**.

Se você não achou: precisa **escolher o cliente antes**, e o Crediário só libera depois disso.

### Lacunas (o que o "fiado" pede e o sistema não faz)
| Necessidade | Hoje |
|---|---|
| Lançar uma dívida **sem produto** ("caderno") | **Não.** A venda exige itens e baixa estoque. |
| Pagamento **parcial** de uma dívida | **Não** (a conta é recebida inteira). |
| **Saldo devedor por cliente** | **Não** há tela nem consulta. |
| Parcelas semanais, quinzenais ou datas livres | **Não** (só mensal). |
| **Cobrança por WhatsApp** de contas a receber | **Não** (existe só para pedidos da loja). |

Essas lacunas também atingem a Cherry (por exemplo, a revendedora que paga em partes).

## 2. Decisão: módulo dentro do Vertumno ou produto separado?
A especificação original (seção 10) diz: **"não deverá ser módulo do ERP"**. Você decidiu rever. Avaliação:

| Critério | Produto separado | **Módulo no Vertumno (recomendado)** |
|---|---|---|
| Login, tenant, papéis, LGPD, deploy | refazer | **reaproveita** |
| Custo de infraestrutura | outra instância/banco | marginal |
| Prazo | maior | **menor** |
| Risco de misturar com o ERP | baixo | **médio** (mitigado abaixo) |
| UX para o dono de mercadinho | simples | depende de um **layout enxuto** |
| Preço de R$ 9,99 | exige cadastro e cobrança próprios | **exige o mesmo** (ver §6) |

**Recomendação:** módulo no Vertumno, com **tabelas próprias** (não mexer em `contas_receber`), ligável por plano (`exigirFuncionalidade('fiado')`, ver `docs/FUNCIONALIDADES.md`) e uma **interface enxuta** (só Fiado no menu quando a empresa só tem essa funcionalidade).
**O que mudaria a recomendação:** se o produto exigir identidade, domínio e cobrança totalmente independentes da GiroNex/Vertumno, ou se o ERP ficar pesado demais para o dono de mercadinho.

> Atenção: **mudar de "independente" para "módulo" altera uma decisão de arquitetura da especificação.** Peço seu "ok" explícito antes de codificar.

## 3. Modelo de dados (proposta)
Tudo com `empresa_id` (do JWT), valores `NUMERIC(12,2)`, migrations aditivas.

**`fiado_lancamentos`** (append-only; nunca `UPDATE`/`DELETE`)
- `id`, `empresa_id`, `cliente_id` (da tabela `clientes` existente, validado no mesmo tenant)
- `tipo`: `compra` | `pagamento` | `estorno`
- `valor` (`> 0`), `descricao` (até 200), `data_lancamento` (DATE, sem conversão de fuso)
- `estorna_id` (nulo; **único**: um lançamento só é estornado uma vez), `motivo` (no estorno)
- `forma` (no pagamento: dinheiro, pix, débito, crédito, outro)
- `chave_idempotencia` (**única por empresa**), `criado_por`, `criado_em`
- Efeito no saldo: compra `+valor`; pagamento `-valor`; estorno **inverte** o lançamento estornado.

**`fiado_saldos`** (um por cliente): `empresa_id`, `cliente_id`, `saldo` com `CHECK (saldo >= 0)`, `atualizado_em`. É atualizado **na mesma transação** do lançamento, com a linha travada (`executarComLock`, contrato do repositório). O saldo é **conferível**: pode ser recalculado pela soma dos lançamentos, e um teste prova que os dois batem.

**Por que dois?** A soma é a verdade auditável; o saldo guardado evita somar tudo a cada tela e dá o `CHECK` no próprio banco ("nunca saldo negativo indevido").

**Opcionais (fase posterior):** `fiado_eventos_cobranca` (clique em "cobrar"), auditoria já coberta pela trilha existente.

## 4. Regras
1. Pagamento **maior que o saldo** → recusa (crédito/troco fica fora do MVP).
2. **Estorno** de compra que deixaria o saldo negativo → recusa (estorne o pagamento antes).
3. Idempotência: `Idempotency-Key` obrigatório nos lançamentos; repetir devolve o mesmo resultado.
4. Papéis: **admin** e **vendedor** lançam; **só admin estorna**; **estoquista** não acessa. Nenhum dado de custo/margem aparece (não existe aqui).
5. LGPD: o histórico financeiro **não é apagado**; se o cliente for anonimizado, o nome some e o extrato fica (mesma regra de `docs/LGPD.md`). Definir retenção com o contador.
6. Cobrança por WhatsApp: o servidor monta a mensagem com o saldo e o `wa.me` codificado (`55` + DDD + número); **o comerciante revisa e envia**. Sem envio automático.

## 5. API (prefixo `/fiado`, autenticada, com `exigirFuncionalidade('fiado')`)
| Método | Rota | Função |
|---|---|---|
| GET | `/fiado/resumo` | total a receber, nº de devedores, compras e pagamentos do período, últimos lançamentos |
| GET | `/fiado/clientes?busca=&com_saldo=` | lista com saldo |
| GET | `/fiado/clientes/:id/extrato` | histórico do cliente |
| POST | `/fiado/clientes/:id/compras` | lança dívida (`valor`, `descricao`, `data?`) |
| POST | `/fiado/clientes/:id/pagamentos` | recebe (parcial ou total) |
| POST | `/fiado/lancamentos/:id/estorno` | só admin, com motivo |
| GET | `/fiado/clientes/:id/cobranca` | mensagem + link `wa.me` |

Clientes continuam sendo criados pela tela de clientes que já existe (nome e telefone).

## 6. O ponto que a especificação original não resolve: R$ 9,99 exige "autoatendimento"
O plano de R$ 9,99 só fecha a conta se **cadastro, login/recuperação de senha e cobrança recorrente forem automáticos**. Hoje:
- A criação de empresa é **privilegiada** (`POST /onboarding` com segredo): **não há cadastro público**.
- Há flag `tem_mensalidade` nos planos, mas **não encontrei cobrança recorrente automática** das mensalidades (confirme).

Ou seja: **o módulo em si é a parte pequena; cadastro e assinatura automáticos são a parte grande**, e servem a **todos** os produtos da GiroNex. Recomendo tratá-los como uma entrega própria (e **não** como "parte do Fiado"), e começar o Fiado **com poucos clientes cadastrados por você**, como na estratégia de aquisição (`docs/ESTRATEGIA_AQUISICAO.md`).

**Canibalização:** quem só precisa de fiado por R$ 9,99 não compra o ERP. Limite o plano (ex.: nº de clientes) e não inclua PDV/estoque nele.

## 7. Custo por escala (hipóteses; **não são medições**)
Premissa: 50 clientes e 300 lançamentos/mês por assinante; ~150 bytes por linha.

| Assinantes | Lançamentos/ano | Dados (sem índices) | Escrita média | Receita bruta mensal (R$ 9,99) |
|---|---|---|---|---|
| 100 | 360 mil | ≈ 54 MB | desprezível | R$ 999 |
| 1.000 | 3,6 milhões | ≈ 540 MB | ≈ 0,1/s | R$ 9.990 |
| 10.000 | 36 milhões | ≈ 5,4 GB | ≈ 1,2/s | R$ 99.900 |

Conta de 10.000: 10.000 × 300 × 12 = 36.000.000 linhas; × 150 B = 5,4 GB; 3.000.000 por mês ÷ 2.592.000 s ≈ 1,2 por segundo. **Na prática o custo não está no banco, e sim em tarifas do gateway, suporte e imposto**, que **não pesquisei**. Não use esta tabela para precificar sem essa pesquisa.

## 8. Fases e critérios de aceite
Tamanho: P = pequeno, M = médio, G = grande.

| Fase | Entrega | Tam. | Critério de aceite |
|---|---|---|---|
| 1. Núcleo | migration, repositório, regras, API de lançamentos e saldo | M | integração: compra/pagamento/estorno, `CHECK` de saldo, idempotência, isolamento entre empresas, concorrência (2 pagamentos simultâneos não estouram o saldo), soma = saldo guardado |
| 2. Telas | clientes com saldo, extrato, lançar compra/pagamento, dashboard | M | usável no celular; erros claros; sem rolagem horizontal |
| 3. Cobrança | mensagem + `wa.me` | P | link correto com acentos e número com DDD; sem envio automático |
| 4. Plano | funcionalidade `fiado` no catálogo e no plano; layout enxuto | P | empresa sem o plano recebe 403; com ele só vê Fiado |
| 5. Piloto | 3 a 5 comerciantes, acompanhados | — | uso semanal; saldo bate com o caderno deles |
| 6. Assinatura e cadastro | **entrega separada** (§6) | G | cobrança recorrente, inadimplência, recuperação de senha |

## 9. Riscos
- **Integridade financeira:** saldo errado destrói a confiança. Mitigação: transação + trava + `CHECK` + teste de conciliação.
- **Segurança:** acesso cruzado entre empresas (todo acesso filtrado por `empresa_id`, com teste dedicado); dado pessoal de clientes de terceiros (LGPD).
- **Produto:** virar um "ERP reduzido" (a especificação alerta). Mantenha o MVP: clientes, dívida, pagamento, cobrança.
- **Operação:** R$ 9,99 não paga suporte humano. Só com autoatendimento.
- **Escopo:** parcelas, juros e multa de atraso **ficam fora** do MVP; para vender em vezes com produto, usar o Crediário do PDV.

## 10. Decisões que preciso de você
1. **OK para o módulo dentro do Vertumno** (e não produto independente)?
2. O Fiado entra **também** para a Cherry (revendedoras que pagam em partes)? Se sim, avalio **pagamento parcial em Contas a receber** como melhoria separada.
3. Preço e limite do plano Fiado.
4. Cadastro automático e cobrança recorrente: **depois dos 10 primeiros clientes** (recomendado) ou antes?
