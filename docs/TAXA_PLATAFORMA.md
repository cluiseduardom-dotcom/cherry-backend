# Taxa interna da plataforma (GiroNex / VERTUMNO)

Percentual cobrado **só sobre a parte da venda paga em Pix** (qualquer Pix: pelo gateway do Mercado Pago ou lançado manualmente) e, nos Pix do Mercado Pago, retido na hora como `application_fee`.
Dinheiro, débito, crédito e crediário **não pagam taxa**: a venda grava a linha em `taxas_venda` com `base_calculo` e `valor` zero, para manter a trilha e a regra congelada. Numa venda mista, a base é a soma dos pagamentos Pix.
Nunca aparece na API de vendas, no PDV, em recibo ou em documento fiscal.

## Qual percentual vale (ordem)
1. **Condição individual** da empresa (`condicoes_comerciais_empresa`, com `empresa_id`), se vigente.
2. **Política do plano** da empresa (`empresa_planos` → `planos_comerciais` → `politicas_taxa_plataforma`), se vigente.
3. Sem plano cadastrado: plano padrão `sem_mensalidade`.

A regra é resolvida sempre pela empresa do JWT e **congelada** em `taxas_venda` (percentual, política, plano e condição) quando a venda é gravada.
Mudar uma taxa **não altera vendas já feitas**.
"Hoje" é calculado no banco, no fuso `America/Sao_Paulo`; vigência é por data (`vigencia_inicio` / `vigencia_fim`, inclusivas).

## Planos (migration 077, decisão do PO em 30/10/2026)
| Plano | Mensalidade | Taxa sobre o Pix |
|---|---|---|
| `cortesia` | não (acesso concedido para conquistar/testar cliente) | 0,50% |
| `basico` | sim | 0,50% |
| `padrao` | sim | 0,40% |
| `pro` | sim | 0,30% |

`sem_mensalidade` e `com_mensalidade` continuam existindo (legado). `sem_mensalidade` segue como plano de empresa sem plano cadastrado. A taxa de cartão (débito/crédito) por plano foi **descartada**: não vale o esforço. Atribuir um plano a uma empresa é ato da GiroNex (`empresa_planos`, SQL com autorização do PO).

Atribuir plano (histórico protegido: encerrar o vigente e criar outro):

```sql
INSERT INTO empresa_planos (empresa_id, plano_id, vigencia_inicio, justificativa, responsavel)
SELECT <empresa_id>, id, DATE '<início>', '<justificativa>', '<responsável>' FROM planos_comerciais WHERE codigo = '<codigo>';
```

## Valores vigentes
Consulte a tabela, não este arquivo:

```sql
SELECT t.id, p.codigo AS plano, t.percentual, t.vigencia_inicio, t.vigencia_fim, t.ativo
FROM politicas_taxa_plataforma t JOIN planos_comerciais p ON p.id = t.plano_id
ORDER BY t.id;
```

`percentual` está em pontos percentuais com 4 casas: `0.5000` = 0,50%.

## Histórico de mudanças em produção
| Data | Plano | De | Para | Observação |
|---|---|---|---|---|
| 30/10/2026 | `sem_mensalidade` | 0,15% | 0,50% | decisão do Product Owner; política 1 encerrada em 29/10, política 3 vigente desde 30/10 |
| 30/10/2026 | `com_mensalidade` | 0,10% | 0,40% | política 2 encerrada em 29/10, política 4 vigente desde 30/10 |

| 30/10/2026 | `cortesia`, `basico`, `padrao`, `pro` | — | 0,50% / 0,50% / 0,40% / 0,30% | planos novos (migration 077); taxa passa a incidir só sobre o Pix |

As migrations (`046`, `048`) continuam semeando 0,15% e 0,10%. Ambientes criados do zero (CI, staging novo) nascem com esses valores e **não** refletem produção; os testes de integração dependem disso. A mudança de produção foi dado, não migration, de propósito.

## Administração de planos e condições (API do operador)
Rotas em `/plataforma`, **só `plataforma_admin` com papel admin** (marca lida do banco). A empresa-alvo vem da rota: é a exceção deliberada ao `empresa_id` do JWT. O responsável gravado é sempre o usuário logado (`email (#id)`), nunca o corpo.

| Rota | O que faz |
|---|---|
| `GET /plataforma/planos` | catálogo com o percentual vigente de cada plano |
| `GET /plataforma/empresas/comercial` | por empresa: plano e condição vigentes e a **regra efetiva** (mesmo resolvedor da venda) |
| `GET /plataforma/empresas/:id/comercial/historico` | todos os planos e condições da empresa, com quem criou e quem encerrou |
| `POST /plataforma/empresas/:id/plano` | `{ plano, vigencia_inicio?, justificativa }`: encerra o plano vigente no dia anterior e cria o novo |
| `POST /plataforma/empresas/:id/condicao` | `{ percentual, vigencia_inicio?, vigencia_fim?, justificativa }`: exceção individual (0 a 100, até 4 casas); substitui a vigente |
| `POST /plataforma/empresas/:id/condicao/encerrar` | `{ a_partir_de?, justificativa }`: encerra a condição; se ainda não começou a valer, cancela |

Regras: a vigência nunca começa no passado (vendas já feitas não são recalculadas); início no mesmo dia de um registro existente é **correção** (o registro é desativado, nunca apagado); plano agendado no futuro bloqueia nova mudança antes dele (409); o plano precisa ter política vigente na data (senão as vendas da empresa falhariam). Migration `078` guarda quem encerrou, quando e por quê. Alterar o **percentual do catálogo** ainda é SQL (seção abaixo).

## Como alterar (só GiroNex; nenhuma rota de tenant escreve estas tabelas)
Não há tela nem API de administração ainda (planejada para depois, restrita a `plataforma_admin`). Hoje é SQL, **com autorização explícita do Product Owner**, em uma transação. Nunca editar o percentual da linha existente: encerrar e criar outra.

Política de um plano (vale para todas as empresas do plano):

```sql
BEGIN;
UPDATE politicas_taxa_plataforma SET vigencia_fim = DATE '<dia anterior ao início>'
 WHERE id = <id vigente> AND vigencia_fim IS NULL AND ativo;
INSERT INTO politicas_taxa_plataforma (tipo, percentual, vigencia_inicio, vigencia_fim, ativo, descricao, plano_id, substitui_id)
SELECT 'percentual', <novo_percentual>, DATE '<início>', NULL, true, '<descrição e decisão>', plano_id, id
  FROM politicas_taxa_plataforma WHERE id = <id vigente>;
COMMIT;
```

Condição individual de uma empresa (exceção negociada; aceita 0): `INSERT INTO condicoes_comerciais_empresa (empresa_id, percentual, vigencia_inicio, justificativa, responsavel) VALUES (...)`.
Histórico de `empresa_planos` e `condicoes_comerciais_empresa` é protegido por trigger: para mudar, encerrar a vigência e criar nova linha.
Só pode haver uma política ativa por plano (e uma condição ativa por empresa) em cada período (constraint de exclusão).

Depois de alterar, conferir na primeira venda que `taxas_venda.percentual` gravou o valor novo.

## Cobrança: fechamento e lançamentos (Painel GiroNex)
SPEC: `docs/SPEC_Taxas_a_Receber_Painel_GiroNex.md`. Tabelas `periodos_taxa` e `lancamentos_taxa` (migrations 114 e 115).
Só operador do painel; o responsável gravado é sempre o da sessão (`painel:<email> (#id)`), e cada ação grava
`plataforma_eventos` na mesma transação.

**Saldo do período** = devido − retido no Mercado Pago + Σ lançamentos (pagamento, perdão e estorno entram negativos;
ajuste com sinal). `a_receber` = saldo, nunca abaixo de zero. Retido maior que o devido só é **sinalizado**
(`retido_maior_que_devido`), nunca vira crédito automático.

| Rota | O que faz |
|---|---|
| `GET /painel/taxas/cobranca?competencia=AAAA-MM[&empresa_id][&status]` | por empresa: status, vencimento, devido, retido, pagamentos, perdões, ajustes, estornos, saldo, **Pix do mês por origem (`pix_mp`, `pix_manual`, `pct_manual`) e `bloqueio_pix_manual`**. Mês aberto = valores vivos |
| `GET /painel/taxas/vendas?competencia=AAAA-MM&empresa_id=N[&somente_divergentes=true][&limit][&offset]` | detalhe por venda com a **conciliação do MP (T6)**: valor Pix (MP × manual), percentual, taxa, retido, retido esperado, divergência e situação (`ok`/`divergente`/`estornada`). Sem cliente, produto, vendedor ou total da venda |
| `GET /painel/taxas/instrucoes-pagamento` | `{ configurado, chave_pix, favorecido }` lidos do ambiente (abaixo); sai no extrato e na mensagem de cobrança |
| `GET /painel/taxas/ciclo` | em que ponto do ciclo está cada loja com saldo a receber (`a_vencer`, `vencido`, `aviso_suspensao`, `suspensao_devida`, `abaixo_do_piso`), com a configuração em vigor. **Só leitura: nada é suspenso nem avisado por esta rota** |
| `POST /painel/empresas/:id/pix-manual/bloquear` `{ justificativa }` | sinaliza a loja e **bloqueia o lançamento de Pix manual** na venda (T7). Um bloqueio ativo por loja (repetir → 409) |
| `POST /painel/empresas/:id/pix-manual/liberar` `{ justificativa }` | libera (ação do admin, com justificativa); sem bloqueio ativo → 409 |
| `POST /painel/taxas/periodos/fechar` `{ competencia, empresa_id? }` | congela devido e retido do mês (só mês já terminado, horário de Brasília); vencimento dia 05 do mês seguinte. Sem `empresa_id`: todas com taxa no mês. Repetir é seguro |
| `GET /painel/taxas/periodos/:id` | período e lançamentos (com responsável e data) |
| `POST /painel/taxas/periodos/:id/pagamentos` `{ valor, data_pagamento, forma_pagamento, comprovante_chave?, chave_idempotencia? }` | só período fechado; parcial aceito; acima do saldo → 409; forma `pix`/`transferencia`/`boleto` |
| `POST /painel/taxas/periodos/:id/comprovantes` (multipart, campo `arquivo`) | envia o comprovante (PDF/JPEG/PNG pelo conteúdo, até 5 MB) ao bucket **privado**; devolve `comprovante_chave` para usar no pagamento. Só período fechado |
| `GET /painel/taxas/lancamentos/:id/comprovante` | baixa o comprovante (só operador, sem URL pública, `no-store`); cada download grava `taxa_comprovante_baixado` |
| `POST /painel/taxas/periodos/:id/perdoes` `{ valor, justificativa, chave_idempotencia? }` | idem, com justificativa |
| `POST /painel/empresas/:id/taxas/ajustes` `{ valor (±), justificativa, venda_id?, chave_idempotencia? }` | sempre no período aberto do mês corrente (fechado não muda) |

Status: `aberto` → `fechado` (com saldo) → `parcialmente_pago` → `pago` (saldo zero; um mês todo retido no MP já fecha pago).
Atraso é calculado pela data (etapa 5), não é status.

**Venda cancelada depois do fechamento:** na própria transação do cancelamento, a parte da taxa que **não** foi retida
no Mercado Pago vira lançamento `estorno_venda` no período aberto do mês corrente (responsável
`sistema: cancelamento da venda #<id> por <login>`). Mês ainda aberto: nada a lançar, o fechamento já não soma a taxa
estornada. A linha do período é o ponto de serialização entre fechamento e cancelamento (teste de corrida em
`tests/routes/painelCobrancaTaxa.integration.test.js`).

### Comprovantes (bucket privado)
Separado das fotos (que são públicas). Sem estas variáveis o envio responde **412** e o pagamento é registrado sem anexo.

| Variável | Valor |
|---|---|
| `R2_ACCOUNT_ID` | a mesma conta das fotos |
| `R2_COMPROVANTES_BUCKET` | bucket **sem acesso público** (sem r2.dev nem domínio público) |
| `R2_COMPROVANTES_ACCESS_KEY_ID` / `R2_COMPROVANTES_SECRET_ACCESS_KEY` | token R2 **restrito a este bucket** (Object Read & Write); nunca o token das fotos |

A chave é gerada pelo backend (`taxas/<empresa>/<período>/<uuid>.<ext>`); o pagamento só aceita comprovante do próprio
período e que exista no bucket. Como o lançamento é imutável, o comprovante é enviado antes do pagamento. Arquivo enviado
e nunca usado em pagamento fica órfão no bucket (sem dado sensível exposto; limpeza manual se necessário).

### Conciliação com o Mercado Pago (T6)
Por venda: **retido esperado** = Σ, por cobrança Pix paga da venda, `ROUND(valor da cobrança × percentual da venda / 100, 2)`
(a mesma conta do `application_fee` na criação da cobrança). **Divergência** = retido − esperado; diferente de zero = venda
`divergente`, contada em `qtd_divergencias` no resumo do mês. A diferença é só **sinalizada** (decisão do PO): correção, se
houver, é ajuste ou perdão manual com justificativa. Causas prováveis: percentual da empresa mudou entre a cobrança e a venda,
ou a comissão do MP não corresponde à registrada (conferir no extrato do Mercado Pago).

### Instrução de pagamento (extrato e WhatsApp)
| Variável | Valor |
|---|---|
| `TAXA_COBRANCA_PIX_CHAVE` | chave Pix da GiroNex que recebe a taxa (até 140 caracteres, sem quebra de linha). Vazia ou inválida = extrato sem instrução de pagamento |
| `TAXA_COBRANCA_FAVORECIDO` | nome do favorecido como aparece no Pix (opcional, até 100 caracteres) |

Não são segredos (o lojista precisa ver), mas ficam no ambiente do Render, não no código.

### Ciclo de cobrança (SPEC §4 e T8) — parte 1: cálculo e leitura
Código: `src/config/cicloCobrancaConfig.js` (parâmetros), `src/utils/cicloCobranca.js` (regra pura) e `src/services/cicloCobrancaService.js`.
A **suspensão do Pix** (abaixo) é aplicada pelo backend das lojas e fica **desligada por padrão**. O aviso à loja dentro do ERP ainda não existe.

| Variável | Valor |
|---|---|
| `COBRANCA_CARENCIA_DIAS` | dias de carência depois do vencimento (0 a 90; padrão **15**: vence dia 05, carência até o dia 20). Único lugar do parâmetro; a futura mensalidade deve usar o mesmo |
| `COBRANCA_PISO` | piso de cobrança em reais (0 a 1000; padrão **10,00**). Valor inválido volta ao padrão |
| `COBRANCA_SUSPENSAO_PIX` | **só a palavra `ligada`** liga a suspensão do Pix das lojas em atraso. Padrão **desligada**; qualquer outro valor (vazio, `true`, `1`) mantém desligada |

Linha do tempo de um período de R$ 25,00 do mês M (vence dia 05 de M+1):

| Dia | Situação |
|---|---|
| 4 e 5 | `a_vencer`, com `lembrete` (1 dia antes do vencimento; sugestão da SPEC) |
| 6 a 14 | `vencido` (em carência) |
| 15 a 20 | `aviso_suspensao` (5 dias antes do fim da carência; sugestão da SPEC) |
| 21 em diante | `suspensao_devida`: a regra manda suspender o Pix. Vale de fato só com `COBRANCA_SUSPENSAO_PIX=ligada` (`pix_suspenso`) |

**Como o T8 foi interpretado** (a SPEC deixa em aberto; confirmar com o PO antes de aplicar a suspensão):
- *Saldo vencido* = soma dos saldos dos períodos com vencimento já passado: acumula de um mês para o outro.
- *Cobrável* (lembrete, aviso, cobrança) = saldo vencido ≥ piso (inclusivo), **ou** saldo vencido > 0 e abaixo do piso há 3 ou mais meses **consecutivos** (cobra mesmo assim, mas nunca suspende).
- *Suspensão devida* = o que **já passou da carência**, período a período, soma pelo menos o piso. Assim um resíduo abaixo do piso nunca suspende, e um mês novo ainda em carência não suspende por causa de um mês antigo pequeno.
- *Aviso* só quando a suspensão realmente vai acontecer no próximo fim de carência (a soma do que terá passado da carência até lá chega ao piso).
- `suspensao_em` = dia seguinte ao fim da carência que fecha o piso, se nada for pago.
- Em centavos inteiros; `hoje` é o dia de São Paulo.

### Pix manual: sinalização e bloqueio (SPEC T7) — etapa 6
Migration `116_bloqueios_pix_empresa.sql`. Decisões do PO (15/11/2026):
- **Quem sinaliza:** só o **operador do painel**, olhando a proporção Pix Mercado Pago × manual de cada loja (`pct_manual`, no resumo do mês). **Não há regra automática**: a SPEC não define "fuga do padrão" e não existe dado real de volume para fixar um limite; um limite errado bloquearia loja honesta. Pode virar automática depois, com dado.
- **O que o bloqueio recusa:** só a **venda no PDV com Pix manual** (Pix sem cobrança do Mercado Pago). Pix do Mercado Pago, dinheiro, débito, crédito e crediário seguem. **Recebimento de conta a receber/fiado com Pix manual não é bloqueado.**

Como funciona:
- Tabela `bloqueios_pix_empresa`: uma linha por bloqueio (motivo `pix_manual_sinalizado`; `suspensao_taxa` já previsto para a etapa 5), com quem abriu, quando e justificativa, e quem liberou, quando e justificativa. **Histórico imutável**: nunca apagado; a liberação só preenche `liberado_*` e não se desfaz (bloquear de novo cria outra linha). Um só bloqueio ativo por loja e motivo (índice único parcial).
- **A validação é no backend** (`vendasRepository.criar`, no início da transação, antes de criar a venda e travar estoque): venda com Pix manual de loja bloqueada responde **403** e **nada** é gravado. Pagamento misto com Pix manual também é recusado inteiro.
- A mensagem ao caixa **não cita taxa, motivo nem sinalização** (a taxa nunca aparece na API de vendas): *"O Pix manual está indisponível para esta empresa. Use o Pix pelo Mercado Pago ou outra forma de pagamento, ou fale com o administrador do sistema."*
- O responsável é sempre o operador da sessão; bloquear e liberar vão para `plataforma_eventos` (`pix_manual_bloqueado`, `pix_manual_liberado`) na mesma transação.
- Corrida: um bloqueio criado no mesmo instante de uma venda em andamento vale a partir da próxima venda (é uma decisão de autorização, não um saldo; não há lock).
- Lacuna conhecida (fora do escopo): o PDV ainda oferece o Pix manual; o caixa só descobre ao finalizar. Esconder a opção quando bloqueado é melhoria do ERP.

### Suspensão do Pix por taxa em atraso — etapa 5, parte 2
Código: `src/services/suspensaoPixService.js`. **Desligada por padrão**: sem `COBRANCA_SUSPENSAO_PIX=ligada` o código vai para produção inerte (nem consulta o banco). Ligar é decisão do PO, depois de conferir a lista de atrasos do painel.

- **Calculada, não armazenada.** A cada tentativa de Pix, a regra do ciclo é aplicada aos meses fechados da loja. Não há rotina agendada nem estado velho: **pagar reativa na hora** (SPEC §4, "reativação automática"). A tabela `bloqueios_pix_empresa` continua sendo só do bloqueio do operador (T7); o motivo `suspensao_taxa` fica reservado e não é usado.
- **Só atinge quem o operador já cobrou:** a suspensão depende de **mês FECHADO** (o fechamento é ação do operador). Loja sem mês fechado, com tudo pago ou com saldo abaixo do piso nunca é suspensa.
- **Onde recusa** (sempre **403**, nunca 409: o PDV lê 409 como "Mercado Pago indisponível" e cairia sozinho para o Pix manual):
  1. venda no PDV com **Pix manual** (`vendasRepository.criar`, junto do bloqueio de T7; a suspensão é conferida primeiro);
  2. **criação de cobrança Pix** no Mercado Pago (`cobrancasPagamentoService.criarPix`): PDV, recebimento de fiado/parcela e loja online.
- **Não recusa:** dinheiro, débito, crédito, crediário, link de cartão, e **Pix JÁ PAGO pelo Mercado Pago** (`cobranca_codigo`): o dinheiro entrou e a venda precisa poder ser registrada. Webhooks e devoluções seguem. Recebimento de conta a receber com Pix manual não é bloqueado (mesmo alcance do T7).
- **Mensagens** (não citam taxa, valor nem motivo; a taxa nunca aparece na API de vendas):
  - caixa/ERP: *"O Pix está indisponível para esta empresa no momento. Use dinheiro, cartão ou crediário, ou fale com o administrador do sistema."*
  - loja online (cliente final): *"O Pix está indisponível nesta loja no momento. Escolha outra forma de pagamento."* (503, `PAGAMENTO_INDISPONIVEL`)
- `GET /painel/taxas/ciclo` passa a trazer `config.suspensao_ativa`, `pix_suspenso` por loja e `totais.pix_suspenso`; `suspensao_em` fica preenchido também depois de a suspensão valer (desde quando).
- **Limitação conhecida:** o PDV ainda oferece o Pix; o caixa só descobre ao tentar (melhoria do ERP, `cherry-frontend`).
