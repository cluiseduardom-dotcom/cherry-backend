# VERTUMNO — Baseline de segurança

## Autenticação e autorização
- Rotas protegidas devem passar pelo middleware de autenticação.
- A autorização deve respeitar o papel do usuário.
- O contexto da empresa deve vir do usuário autenticado quando aplicável.

## Dados
- Consultas devem ser isoladas por empresa.
- Não confiar em identificadores de empresa enviados pelo frontend.
- Validar parâmetros, payloads e filtros.

## Segredos
- Segredos pertencem ao ambiente, nunca ao repositório.
- Não registrar tokens, senhas ou credenciais em logs.

## Banco
- Operações críticas devem usar transações.
- Concorrência deve ser considerada em sequências, estoque, pagamentos e saldos.
- Constraints devem ser usadas para reforçar integridade quando apropriado.

## Alterações de segurança
Qualquer mudança que reduza autenticação, autorização, validação, isolamento multi-tenant ou auditoria exige revisão explícita.

## Regra para agentes
Nunca remover uma proteção de segurança apenas para fazer um teste, corrigir um erro superficial ou simplificar implementação.
