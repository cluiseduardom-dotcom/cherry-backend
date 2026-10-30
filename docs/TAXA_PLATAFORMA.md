# Taxa interna da plataforma (GiroOne / VERTUMNO)

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

`sem_mensalidade` e `com_mensalidade` continuam existindo (legado). `sem_mensalidade` segue como plano de empresa sem plano cadastrado. A taxa de cartão (débito/crédito) por plano foi **descartada**: não vale o esforço. Atribuir um plano a uma empresa é ato da GiroOne (`empresa_planos`, SQL com autorização do PO).

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

## Como alterar (só GiroOne; nenhuma rota de tenant escreve estas tabelas)
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
