# VERTUMNO — Quality Gate

Uma alteração é tecnicamente pronta somente quando os checks obrigatórios do repositório passam.

## Backend
- npm ci
- syntax check
- migrations
- seed
- Jest

## Frontend
- npm ci
- Oxlint
- Vitest
- build

## Regras
1. CI vermelho bloqueia a conclusão da tarefa.
2. Não silenciar testes para obter CI verde.
3. Não remover validações para contornar falhas.
4. Falhas de infraestrutura devem ser distinguidas de falhas do código.
5. Alterações de banco devem ser avaliadas junto com migrations e integridade.
6. Uma funcionalidade crítica deve também ser homologada pelo fluxo completo, não apenas por testes unitários.

## Objetivo
O CI é um quality gate automatizado, não uma substituição da revisão técnica ou homologação do produto.
