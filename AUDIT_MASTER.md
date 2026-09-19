# CHERRY BACKEND — AUDIT MASTER

> Auditoria inicial do backend para o ciclo GPT + Claude + Gemini.
> Base: cf31b8604dce7389af0b29e86af528a50dd4e320
> Data: 2026-09-19

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

## Achados

| ID | Área | Achado | Prioridade | Ação |
|---|---|---|---|---|
| BE-AUD-001 | Segurança | `helmet` está instalado, mas não está aplicado em `app.js` | Alta | Avaliar e ativar com teste de integração |
| BE-AUD-002 | CORS | `cors()` está aberto sem allowlist de origem | Alta | Definir origens por ambiente antes de produção multi-cliente |
| BE-AUD-003 | Auth | JWT de 8h, sem refresh/revogação | Média | Decisão de produto/segurança antes de alterar |
| BE-AUD-004 | Multi-tenant | Testes de isolamento real ainda não cobrem todos os módulos | Alta | Criar matriz de cobertura e testes de integração |
| BE-AUD-005 | Onboarding | Não existe endpoint para criar empresa; seed é usado para a empresa inicial | Alta para GiroOne | Definir fluxo de criação de tenant antes de comercialização |
| BE-AUD-006 | Canais | Não existe endpoint de criação/gestão de canais de venda | Média | Decidir se canais serão configuráveis pelo admin |
| BE-AUD-007 | CI | Backend roda Node 20 no CI enquanto o frontend usa outra versão | Média | Padronizar runtime suportado e documentá-lo |
| BE-AUD-008 | Documentação | `CLAUDE.md` ainda descreve frontend como TypeScript/Tailwind | Média | Corrigir referência para stack real |
| BE-AUD-009 | Documentação | Há trechos históricos no MAPA que precisam ser conferidos contra o código atual | Média | Tratar documentação como artefato versionado e validar divergências |
| BE-AUD-010 | Observabilidade | Há health-check, mas roteiro ainda não possui observabilidade/alertas completos | Média | Planejar logs estruturados, uptime e alertas |

## Pontos positivos

### Segurança e isolamento
- `empresa_id` vem do JWT, não do body/query.
- Leituras por ID devem filtrar empresa na própria query.
- Referências cruzadas são validadas dentro da empresa.
- Vendedor não deve receber custo/margem/lucro sensíveis.
- Login possui rate limit.
- Rotas financeiras sensíveis usam `requireAdmin`.
- Estoque usa bloqueio contra saldo negativo e transações.

### Integridade histórica
- Preço e custo da venda são congelados no item vendido.
- Movimentação de estoque é ledger.
- Cancelamento de venda estorna estoque.
- Vigência de despesas fixas é tratada cronologicamente.
- Categorias/SKU têm regras explícitas e testes.

## Matriz de risco para a próxima etapa

### P0 — antes de comercialização
1. Multi-tenant com teste real para todos os módulos.
2. CORS por ambiente.
3. Helmet/headers de segurança.
4. Onboarding de empresa/tenant.
5. Staging separado de produção.

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

Não implementar nenhum item deste documento automaticamente. Cada alteração deve virar tarefa pequena, com critério de aceite, testes e PR.

## Próxima auditoria

Comparar os contratos do backend com as telas e services do frontend, procurando:
- payloads descartados;
- campos obrigatórios divergentes;
- status/erros inconsistentes;
- permissões divergentes;
- regras de preço/estoque/venda duplicadas no frontend;
- endpoints existentes sem UX;
- UX prometendo comportamento que o backend não suporta.
