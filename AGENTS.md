# VERTUMNO — Regras para agentes de desenvolvimento

## 1. Fonte de verdade
- O GitHub é a fonte oficial do código.
- Trabalhe sempre na branch/tarefa indicada.
- Não altere `master` diretamente.
- Não reescreva histórico existente.

## 2. Regra de negócio
- Não invente regras de negócio.
- Se uma regra estiver ambígua ou contraditória, pare e sinalize a dúvida.
- Não remova uma regra existente apenas para fazer testes passarem.
- Preserve histórico de estoque, vendas, pagamentos e financeiro.

## 3. Multi-tenant
- Operações de dados devem respeitar `empresa_id`.
- Nunca exponha ou altere dados de outra empresa.
- Não aceite `empresa_id` arbitrário do cliente quando ele deve vir do contexto autenticado.

## 4. Banco de dados
- Migrations já aplicadas não devem ser editadas para corrigir comportamento.
- Correções devem usar nova migration.
- Mudanças de schema devem considerar constraints, índices, transações e concorrência.
- Alterações de dados críticos devem ser reversíveis ou ter estratégia explícita de recuperação.

## 5. Segurança
- Respeite autenticação e autorização existentes.
- Não enfraqueça JWT, bcrypt, CORS, Helmet, rate limiting ou validações para facilitar testes.
- Entradas externas devem ser validadas.
- Não coloque segredos, tokens ou credenciais no código.

## 6. Testes
- Toda nova regra relevante deve ter teste.
- Não remova testes existentes sem justificativa.
- Falha de CI deve ser investigada antes do merge.
- Não silencie erros apenas para obter CI verde.

## 7. Escopo
- Faça a menor alteração necessária para cumprir a tarefa.
- Não faça refatorações oportunistas fora do escopo.
- Se identificar melhoria fora do escopo, registre como sugestão separada.

## 8. Entrega
Antes de concluir:
1. verifique arquivos alterados;
2. execute os testes aplicáveis;
3. confira migrations;
4. confira permissões;
5. confira impacto nos módulos relacionados;
6. descreva riscos ou pendências no PR.

## 9. Regra de segurança máxima
Se houver conflito entre velocidade e integridade de dados, priorize a integridade.
