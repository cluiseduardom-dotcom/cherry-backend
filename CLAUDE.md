# VERTUMNO / Cherry Backend — Claude Code

Este arquivo é o contrato operacional do Claude Code para este repositório. Deve permanecer curto, atual e coerente com o código real. Regras históricas, bugs já corrigidos e decisões temporárias não devem ser acumulados aqui; documente detalhes na PR, issue ou SDD quando necessário.

## 1. Papéis
- Product Owner: define/valida regras de negócio e aprova o merge.
- GPT: arquitetura, especificação, auditoria e gate técnico.
- Claude Code: investigação, implementação, testes, revisão do próprio diff e abertura da PR.
- GitHub Actions: validação automatizada.
- Claude Code não faz merge da própria PR e não altera master diretamente.

## 2. Stack e arquitetura
- Node.js + Express
- PostgreSQL / Neon
- pg
- JWT + bcrypt
- Jest
- Deploy atual: Render
- Frontend separado: cherry-frontend (React/Vite/TypeScript/Tailwind)
- O sistema é multi-tenant. Dados de negócio pertencem a empresa_id.

## 3. Regras invioláveis

### Multi-tenant
- empresa_id vem do JWT (req.usuario.empresa_id), nunca do body/query do cliente.
- Toda tabela de negócio nova deve ter empresa_id quando aplicável.
- Toda operação de leitura/escrita por recurso deve filtrar por empresa_id na própria query.
- Referências entre recursos devem ser validadas dentro do mesmo tenant.
- Nunca usar apenas o id do recurso como fronteira de segurança.
- Exceção deliberada: `politicas_taxa_plataforma` (taxa interna da plataforma) é global da GiroOne/VERTUMNO, sem `empresa_id`; nenhuma rota de tenant a escreve. A taxa de cada venda (`taxas_venda`) tem `empresa_id` e nunca aparece na API de vendas, no PDV, em recibo ou em documento fiscal.

### Segurança e RBAC
- O frontend nunca é fronteira de segurança.
- Toda rota protegida deve validar autenticação e autorização no backend.
- Papéis atuais: admin, vendedor, estoquista.
- vendedor nunca recebe custo, margem ou lucro em respostas da API.
- estoquista não acessa vendas nem financeiro.
- Criação/remoção de usuários: somente admin.
- Nunca commitar, logar ou expor secrets, tokens, senhas, .env ou DATABASE_URL.
- Credenciais de teste devem usar hashes/segredos próprios de CI/dev e nunca credenciais reais.

### Integridade
- Operações que alteram estoque, vendas ou dinheiro devem usar transação.
- Operações concorrentes sobre estoque/financeiro devem usar locks apropriados.
- Nunca permitir estoque negativo.
- Histórico operacional/financeiro não deve ser apagado para esconder uma operação; usar cancelamento/soft delete conforme a regra do módulo.
- Idempotência deve ser considerada em operações que possam ser repetidas por retry, webhook ou concorrência.

### Banco e migrations
- Alterações de schema entram em migration versionada.
- Não alterar migration já aplicada/mergeada para corrigir histórico; criar migration corretiva.
- schema.sql deve acompanhar o estado consolidado do schema quando a convenção do projeto exigir.
- Nunca executar SQL destrutivo em produção sem autorização explícita.
- Não fazer alteração direta em produção como parte de uma tarefa de código.

### Datas e valores
- Colunas DATE devem preservar YYYY-MM-DD sem conversão indevida para Date/UTC.
- Usar nomes de banco/API em português, snake_case, conforme o padrão existente (criado_em, atualizado_em).
- Valores financeiros devem ser validados como números finitos e tratados de forma consistente.

## 4. CI e ambientes
A CI é isolada e não deve depender de banco persistente de produção, staging ou Neon.
- GitHub Actions usa PostgreSQL efêmero para testes.
- DATABASE_URL da CI aponta para o PostgreSQL do próprio job.
- JWT_SECRET da CI é exclusivo e não é segredo de produção.
- A sequência mínima da CI é: instalar dependências; validar sintaxe; aplicar migrations; executar seed; executar testes; executar o quality gate configurado.
- A CI não deve escrever em bancos reais.
- O seed de CI/dev deve ser idempotente.
- Antes de alterar CI, verificar o workflow real em .github/workflows/ci.yml; este arquivo não substitui a configuração executável.

## 5. Fluxo de desenvolvimento
1. Partir de master atualizado.
2. Criar uma branch por tarefa: feat/<modulo>, fix/<modulo> ou chore/<modulo>.
3. Investigar o código existente antes de implementar.
4. Não duplicar serviços, repositories, rotas, componentes ou regras existentes.
5. Implementar somente o escopo solicitado.
6. Testar a alteração e os fluxos afetados.
7. Revisar o diff completo.
8. Abrir PR com evidências.
9. Se a CI falhar, corrigir na mesma branch/PR.
10. Merge somente após CI verde, revisão arquitetural e aprovação do Product Owner.
- Nunca usar push --force em branch compartilhada sem autorização.

## 6. Contrato de entrega da PR
Toda PR deve informar:
1. objetivo;
2. arquivos/migrations alterados;
3. regras de negócio;
4. impacto em multi-tenant/RBAC;
5. testes executados e resultado;
6. migrations que precisam ser aplicadas;
7. riscos/pontos pendentes;
8. confirmação de que não houve alteração fora do escopo.

## 7. Regra para novas funcionalidades
Antes de codificar:
- confirmar se a funcionalidade já existe;
- identificar contrato real da API;
- identificar tabelas/migrations existentes;
- preservar isolamento, RBAC, transações e auditoria;
- confirmar se a mudança é de código, regra de negócio ou schema.
Se a mudança for irreversível ou alterar regra de negócio já aprovada, parar e pedir confirmação.

## 8. Estado do produto
Este repositório é o backend do VERTUMNO, inicialmente validado com a operação da Cherry Semijoias.
Detalhes de regras específicas dos módulos devem permanecer no SDD/issues/PRs ou em documentação específica, não crescer indefinidamente neste arquivo.

## 9. Fluxo de IA
Product Owner → GPT (especificação/arquitetura/auditoria) → Claude Code (implementação/testes/PR) → GitHub Actions (CI) → GPT (revisão técnica) → Product Owner (aprovação) → Merge.

Regra final: código que funciona não é automaticamente código pronto para produção. O gate considera funcionalidade, segurança, isolamento de tenant, integridade transacional, testes, observabilidade, recuperação e manutenção.