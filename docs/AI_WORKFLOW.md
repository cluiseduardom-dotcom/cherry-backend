# VERTUMNO — Fluxo de desenvolvimento assistido por IA

## Objetivo
Aumentar velocidade e produtividade sem reduzir qualidade, segurança, rastreabilidade ou controle humano.

## Papéis

### GPT
Tech Lead / arquiteto:
- entender o objetivo;
- analisar impacto;
- definir regras;
- dividir a tarefa;
- definir critérios de aceite;
- revisar a entrega.

### Claude
Executor principal:
- implementar backend e tarefas de código atribuídas;
- criar testes;
- preparar commits/PRs;
- corrigir falhas identificadas pelo CI ou revisão.

### Codex
Segundo engenheiro:
- revisão independente;
- debugging complexo;
- tarefas paralelas;
- automações de engenharia quando fizer sentido.

### Gemini
UX/UI e exploração visual:
- propor experiências de uso;
- trabalhar componentes e telas atribuídas;
- respeitar o Design System;
- não alterar regras de negócio sem especificação.

### CI
Gate obrigatório:
- instalação;
- migrations;
- seed;
- validações de sintaxe;
- testes;
- demais checks configurados.

### Usuário
Product Owner:
- define objetivo e prioridades;
- decide regras de negócio ambíguas;
- aprova mudanças de produto;
- homologa funcionalidades relevantes.

## Fluxo padrão

1. Objetivo definido.
2. GPT analisa impacto.
3. Especificação e critérios de aceite são definidos.
4. Uma ferramenta é escolhida como executor principal.
5. Execução ocorre em branch.
6. CI valida.
7. Revisão técnica ocorre.
8. Correções são feitas.
9. Usuário homologa quando necessário.
10. Merge.

## Princípios
- Um executor principal por tarefa.
- GitHub é a fonte de verdade.
- CI não é opcional.
- Nenhum agente deve inventar requisito.
- Nenhum agente deve contornar segurança para acelerar entrega.
- Mudanças fora do escopo devem ser separadas.
