# Taxa interna da plataforma (GiroOne / VERTUMNO)

Percentual cobrado sobre o **total de cada venda** e, nos Pix do Mercado Pago, retido como `application_fee`.
Nunca aparece na API de vendas, no PDV, em recibo ou em documento fiscal.

## Qual percentual vale (ordem)
1. **Condição individual** da empresa (`condicoes_comerciais_empresa`, com `empresa_id`), se vigente.
2. **Política do plano** da empresa (`empresa_planos` → `planos_comerciais` → `politicas_taxa_plataforma`), se vigente.
3. Sem plano cadastrado: plano padrão `sem_mensalidade`.

A regra é resolvida sempre pela empresa do JWT e **congelada** em `taxas_venda` (percentual, política, plano e condição) quando a venda é gravada.
Mudar uma taxa **não altera vendas já feitas**.
"Hoje" é calculado no banco, no fuso `America/Sao_Paulo`; vigência é por data (`vigencia_inicio` / `vigencia_fim`, inclusivas).

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

As migrations (`046`, `048`) continuam semeando 0,15% e 0,10%. Ambientes criados do zero (CI, staging novo) nascem com esses valores e **não** refletem produção; os testes de integração dependem disso. A mudança de produção foi dado, não migration, de propósito.

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
