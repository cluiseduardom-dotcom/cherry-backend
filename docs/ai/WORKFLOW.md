# AI WORKFLOW — VERTUMNO

## Objetivo

Este documento define como GPT, Gemini, Claude Code, GitHub Actions e o Product Owner colaboram no desenvolvimento do VERTUMNO.

A regra central é:

> Cada IA tem uma função diferente. Nenhuma deve substituir as demais.

## Papéis

### GPT-5.6 Luna — ARQUITETO E AUDITOR

Responsabilidades:
- interpretar requisitos de negócio;
- manter coerência com o SDD;
- analisar arquitetura e impacto no sistema;
- identificar reutilização de código existente;
- definir regras de negócio;
- definir critérios de aceite;
- consolidar contribuições de UX;
- preparar especificações para o executor;
- auditar PRs do Claude;
- verificar segurança, multi-tenant, RBAC, transações, migrations e regressões.

GPT não deve assumir o papel de executor principal quando a tarefa foi delegada ao Claude Code.

### Gemini — UX/UI E EXPLORAÇÃO

Responsabilidades:
- explorar alternativas de experiência do usuário;
- propor fluxos de tela;
- avaliar hierarquia de informação;
- propor componentes, estados, mensagens e interações;
- identificar pontos de fricção operacional;
- produzir referências/protótipos quando úteis;
- questionar complexidade desnecessária na interface.

Gemini não decide sozinho regras de negócio nem arquitetura de backend.

Quando houver divergência entre uma proposta de UX e uma regra de negócio/arquitetura, GPT consolida a decisão antes da implementação.

### Claude Code — EXECUTOR

Responsabilidades:
- investigar o código real;
- implementar a especificação;
- criar/alterar migrations;
- implementar backend/frontend;
- criar e atualizar testes;
- executar lint/build/testes;
- corrigir falhas da CI;
- criar commits;
- abrir PR.

Claude Code não faz merge e não altera `master` diretamente.

### GitHub Actions — VALIDADOR

Responsabilidades:
- executar a suíte automatizada;
- validar lint/syntax/build conforme o repositório;
- bloquear a integração quando a CI falhar.

CI não substitui revisão arquitetural.

### Product Owner — DECISÃO

O Product Owner:
- define prioridades;
- decide regras de negócio quando necessário;
- valida comportamento;
- testa a funcionalidade;
- aprova o merge.

## Fluxo oficial

```
                    PRODUCT OWNER
                          │
                          ▼
                 GPT — ARQUITETURA
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       GEMINI — UX/UI          GPT — REGRAS
              │                       │
              └───────────┬───────────┘
                          ▼
                 GPT — CONSOLIDAÇÃO
                          │
                          ▼
                  CLAUDE CODE
                 IMPLEMENTAÇÃO
                          │
                          ▼
                       GITHUB
                          │
                          ▼
                  GITHUB ACTIONS
                       CI
                          │
                          ▼
                    GPT — AUDITORIA
                          │
                          ▼
                 PRODUCT OWNER
                     APROVA
                          │
                          ▼
                       MERGE
```

## Quando envolver o Gemini

### Obrigatório/recomendado
Envolver Gemini quando a tarefa alterar:
- telas;
- navegação;
- formulários;
- dashboards;
- fluxos operacionais;
- mensagens e estados de erro;
- experiência de cadastro/consulta;
- responsividade;
- descoberta de novas funcionalidades voltadas ao usuário.

### Normalmente dispensável
Não é necessário envolver Gemini em:
- migration puramente técnica;
- correção de bug interno sem impacto visual;
- refatoração interna;
- ajuste de índice;
- correção de CI;
- integração de infraestrutura sem alteração de UX.

## Contrato entre as IAs

### GPT → Gemini
GPT envia:
- objetivo da funcionalidade;
- público/role;
- contexto da operação;
- restrições de negócio;
- telas afetadas;
- problemas de UX que precisam ser resolvidos.

Gemini devolve:
- fluxo recomendado;
- hierarquia de informação;
- estados da interface;
- componentes/interações;
- riscos de UX;
- alternativas quando houver mais de uma abordagem razoável.

### GPT → Claude
GPT envia uma especificação consolidada contendo:
- objetivo;
- contexto existente;
- arquitetura;
- regras;
- UX definida;
- banco;
- backend/frontend;
- segurança;
- testes;
- critérios de aceite;
- não fazer.

Claude não deve implementar diretamente uma sugestão isolada do Gemini sem essa consolidação.

### Claude → GPT
A PR deve informar:
- implementação;
- arquivos alterados;
- migrations;
- testes;
- lint/build;
- riscos;
- pontos pendentes;
- confirmação de escopo.

### GPT → Product Owner
GPT apresenta:
- o que foi implementado;
- o que foi validado;
- eventuais riscos;
- o que precisa ser testado pelo Product Owner.

## Regra de conflito

Se houver conflito:

1. regra legal/segurança → prevalece;
2. regra de negócio aprovada → prevalece;
3. arquitetura do SDD → prevalece;
4. decisão explícita do Product Owner → prevalece;
5. UX proposta pelo Gemini é ajustada para respeitar os itens acima.

Nenhuma IA deve ocultar uma divergência relevante.

## Princípio de UX do VERTUMNO

> Complexidade no motor, simplicidade na operação.

A interface deve ser orientada pela intenção do usuário e não pela estrutura interna do banco.

O sistema pode possuir OC, PC, recebimento, liquidação, conciliação e eventos internamente sem obrigar o usuário a compreender todos esses conceitos para executar uma operação simples.

## Regra de fonte de verdade

- Código real: GitHub.
- Banco: migrations + estado do ambiente.
- Regras de negócio: SDD/ADRs/documentação aprovada.
- UX: especificação consolidada pelo GPT após análise do Gemini.
- Execução: Claude Code.
- Validação automática: GitHub Actions.
- Decisão final de produto: Product Owner.

## Regra operacional

Nenhuma nova feature deve começar com implementação imediata.

Primeiro:
1. entender o problema;
2. verificar o que já existe;
3. definir arquitetura;
4. envolver Gemini se houver impacto de UX;
5. consolidar especificação;
6. delegar implementação ao Claude;
7. validar CI;
8. auditar PR;
9. Product Owner testa;
10. merge.

