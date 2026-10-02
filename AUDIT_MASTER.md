# CHERRY BACKEND — AUDIT MASTER

> Auditoria consolidada do backend para o ciclo GPT + Claude + Gemini.
> Estado verificado contra o código em `master`.
> Última revisão: 2026-09-19
> Master verificado: `f996c886f69b0a86135bdee0bf12dc54ff3faa6f`

## Estado técnico confirmado

- Node.js + Express 5
- PostgreSQL via pg / Neon
- JWT + bcrypt
- Zod
- Jest + Supertest
- Render
- CI via GitHub Actions
- Multi-tenant por `empresa_id`
- RBAC por middleware e filtragem de campos sensíveis
- Ledger append-only para movimentações de estoque e preços

## Estado atual dos achados

| ID | Área | Achado | Estado | Próxima ação |
|---|---|---|---|---|
| BE-AUD-001 | Segurança | `helmet` instalado e não aplicado | **Resolvido** | Manter testes de headers |
| BE-AUD-002 | CORS | CORS aberto sem allowlist | **Resolvido** | Configurar `CORS_ORIGINS` por ambiente em produção |
| BE-AUD-003 | Auth | JWT de 8h, sem refresh/revogação | **Aberto** | Definir política de sessão antes de comercialização |
| BE-AUD-004 | Multi-tenant | Testes reais não cobrem todos os módulos | **Resolvido** | Manter testes de isolamento ao adicionar novos módulos |
| BE-AUD-005 | Onboarding | Sem endpoint de criação de empresa | **Resolvido** | Validar fluxo comercial e controles de abuso em staging |
| BE-AUD-006 | Canais | Sem endpoint de criação/gestão de canais | **Aberto** | Decidir se admin poderá criar/editar canais |
| BE-AUD-007 | CI/runtime | Backend em Node 20 e frontend em Node 22 | **Aberto** | Padronizar runtime suportado |
| BE-AUD-008 | Documentação | Referências históricas de stack ainda existem em docs | **Aberto** | Corrigir docs obsoletos |
| BE-AUD-009 | Documentação | MAPA contém trechos históricos | **Aberto** | Atualizar mapa contra código real |
| BE-AUD-010 | Observabilidade | Health-check sem observabilidade operacional completa | **Aberto** | Logs estruturados, métricas e alertas |
| BE-AUD-011 | Banco/CI | Base persistente usada pelo CI não possui a tabela da migration 020 (`niveis_categoria`) | **Resolvido** | Usar `npm run db:migrate` antes do seed em CI/staging/produção |

## Cobertura real de isolamento

A suíte `tests/routes/multiTenantIsolation.test.js` hoje cobre, por integração real:

- produtos;
- clientes;
- vendas;
- contas a pagar;
- fornecedores;
- canais de venda;
- contas a receber;
- despesas fixas;
- configurações financeiras;
- compras;
- categorias de produto;
- produção;
- acesso cruzado por ID em módulos críticos.

A cobertura real de `niveis_categoria` foi incorporada após a criação do runner de migrations. O teste usa a API real e não cria schema dentro da suíte.

## Onboarding

O backend agora possui fluxo público de onboarding para criação de tenant e primeiro administrador, com validação e rate limit específicos.

O fluxo precisa ser validado operacionalmente em staging antes de qualquer exposição comercial ampla, principalmente para unicidade, abuso de endpoint, CORS e política de e-mail/senha. O backend agora falha cedo quando a configuração mínima de produção está incompleta.

## Pontos positivos

### Segurança e isolamento

- `empresa_id` vem do JWT, não do body/query.
- Leituras por ID filtram a empresa na própria query nos módulos auditados.
- Referências cruzadas são validadas dentro da empresa.
- Vendedor não recebe custo/margem/lucro sensíveis.
- Login possui rate limit.
- Rotas financeiras sensíveis usam `requireAdmin`.
- Estoque usa bloqueio contra saldo negativo e transações.

### Integridade histórica

- Preço e custo da venda são congelados no item vendido.
- Movimentação de estoque é ledger.
- Cancelamento de venda estorna estoque.
- Vigência de despesas fixas é tratada cronologicamente.
- Categorias/SKU têm regras explícitas e testes.
- Produção usa transação única e isolamento por empresa.

## Matriz de prioridade atual

### P0 — antes de comercialização

1. Executar validação operacional de onboarding em staging.
2. Criar/confirmar serviços e bancos Render separados para staging e produção.

### P1 — profissionalização

1. Observabilidade.
2. LGPD operacional/documental.
3. Política de autenticação/token.
4. Padronização de runtime.
5. Cobertura E2E dos fluxos críticos.

### P2 — evolução

1. Configuração de canais.
2. Módulos adicionais.
3. Otimizações de escala orientadas por métricas.

## Regra de trabalho

Cada alteração deve ser pequena, ter critério de aceite, testes automatizados e PR. Correções estruturais que revelarem problemas de ambiente ou dados compartilhados não devem ser mascaradas por fixtures artificiais.

## Próxima auditoria

Com a cobertura de isolamento e o versionamento básico do banco fechados, a próxima revisão deve concentrar-se em:

- governança das migrations entre desenvolvimento, CI, staging e produção;
- execução operacional do onboarding e separação dos serviços Render;
- onboarding e segurança operacional;
- observabilidade;
- E2E dos fluxos críticos;
- divergências restantes entre documentação e implementação.
