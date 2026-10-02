# AI Execution Contract — VERTUMNO

## 1. Purpose

Define the execution contract for AI-assisted changes in the VERTUMNO ERP.

This document converts a product/technical task into a controlled implementation unit that can be executed by Claude, Codex or another authorized agent without weakening architecture, security or traceability.

## 2. Source of truth

The order of authority is:

1. Current repository code and database schema
2. Accepted product/technical requirements
3. `AGENTS.md`
4. `docs/AI_WORKFLOW.md`
5. `docs/ARCHITECTURE.md`
6. `docs/SECURITY.md`
7. Task specification
8. Agent assumptions

If two sources conflict, stop and surface the conflict. Never silently choose an interpretation.

## 3. Task contract

Every implementation task must define:

- Task ID and title
- Objective
- Context
- Scope included
- Scope excluded
- Affected modules
- Business rules
- Database impact
- API/backend impact
- Security and tenant isolation requirements
- Integrations
- Acceptance criteria
- Required tests
- Executor
- Reviewer
- Known risks

The executor must implement only the defined scope.

## 4. Agent responsibilities

### GPT — Technical Lead / Orchestrator

Responsible for:

- translating the product objective into an executable task
- checking architecture and dependencies
- identifying ambiguity and risks
- selecting the primary executor
- defining acceptance criteria
- reviewing the resulting change at the system level

GPT does not invent business rules.

### Claude — Primary implementation agent

Default executor for:

- backend implementation
- frontend implementation
- database changes
- tests
- routine refactoring strictly required by the task

Claude must work in a dedicated branch and open a PR.

### Codex — Secondary engineer

Used for:

- code review
- debugging failed CI
- test analysis
- security review
- migration/schema review
- automation and repository maintenance

Codex should not duplicate the primary implementation unless explicitly assigned.

### Gemini — UX/UI specialist

Used primarily for:

- UX flows
- visual hierarchy
- component behavior
- responsive design
- interaction details
- design-system consistency

Gemini proposes or implements only the UI scope assigned to it.

### CI — Quality Gate

CI is an objective gate. A task is not complete while required checks are failing.

### Product Owner — Human

The human decides:

- business rules
- priorities
- scope changes
- exceptions
- final homologation and merge

## 5. Execution rules

The executor MUST:

- create/use a dedicated feature or chore branch
- never commit directly to `master`
- inspect existing implementation before changing it
- preserve multi-tenant isolation through `empresa_id`
- preserve authentication and authorization
- use migrations for database changes
- never edit an already-applied migration to change history
- add a new migration when a database correction is required
- preserve audit/history requirements
- add or update tests for changed behavior
- keep the smallest safe change
- document relevant architectural decisions
- open a PR with the required template

The executor MUST NOT:

- invent business rules
- remove tests to make CI pass
- weaken validation or authorization
- bypass tenant isolation
- silently change unrelated modules
- delete historical data to simplify implementation
- modify production behavior outside the task scope
- hide warnings or failures
- merge its own PR unless explicitly authorized

## 6. Ambiguity protocol

When a requirement is ambiguous:

1. Check existing code, schema and documentation.
2. Check whether an established pattern exists elsewhere in the repository.
3. If the answer is objectively determined by existing architecture, follow it.
4. If it changes business behavior, security, financial logic or data semantics, STOP.
5. Report the ambiguity with at least two concrete interpretations and the affected consequences.
6. Wait for Product Owner/Technical Lead decision.

Never resolve a material business ambiguity by guessing.

## 7. CI failure protocol

When CI fails:

1. Identify the exact failing job and step.
2. Reproduce or inspect the failure.
3. Classify it as:
   - implementation defect
   - test defect
   - environment/tooling issue
   - pre-existing failure
   - unrelated failure
4. Fix only the relevant cause.
5. Never remove or weaken a test solely to obtain green CI.
6. Re-run the required checks.
7. Record the result in the PR.

If the failure is unrelated to the task, document it rather than hiding it.

## 8. Scope expansion protocol

If implementation reveals a necessary change outside the original scope:

- do not silently expand the task;
- identify the dependency;
- explain why it is necessary;
- estimate impact;
- request approval when it changes behavior, schema, security or another module's contract.

Small mechanical changes required for compilation or integration may be included when they do not alter business behavior, but must be documented in the PR.

## 9. Database safety

For every schema change:

- verify the current schema first;
- create an additive migration;
- preserve existing data;
- preserve tenant boundaries;
- consider rollback/recovery;
- update repository/service/validation layers consistently;
- run migrations and tests in CI.

Applied migrations are immutable history.

## 10. Security gate

Before PR completion verify:

- authentication
- authorization
- `empresa_id` isolation
- input validation
- SQL parameterization
- sensitive data handling
- rate limiting where applicable
- no secrets committed
- no trust placed solely in frontend controls

A functional feature with a security regression is not complete.

## 11. Definition of Done

A task is DONE only when:

- implementation matches the task contract;
- acceptance criteria are met;
- tests are added/updated;
- required CI checks are green;
- security impact was reviewed;
- database changes are migrated safely;
- PR description is complete;
- no unexplained scope changes remain;
- Product Owner can perform homologation.

## 12. Standard handoff

The executor's final PR handoff must contain:

### Implemented
What changed.

### Files/modules
Relevant files and why.

### Business rules
Rules implemented.

### Database
Migrations/schema changes.

### Security
Auth, authorization and tenant-isolation impact.

### Tests
Tests created/changed and results.

### CI
Required checks and final status.

### Known limitations
Anything intentionally left outside scope.

### Homologation
Exact steps for the Product Owner to validate the feature.

## 13. Standard task envelope

Use this structure when GPT dispatches work:

```text
TASK ID:
TITLE:

OBJECTIVE:

CONTEXT:

SCOPE IN:
- 

SCOPE OUT:
- 

AFFECTED MODULES:
- 

BUSINESS RULES:
- 

DATABASE:
- 

API/BACKEND:
- 

FRONTEND/UX:
- 

SECURITY:
- 

ACCEPTANCE CRITERIA:
- 

TESTS:
- 

PRIMARY EXECUTOR:
- 

SECONDARY REVIEWER:
- 

RISKS:
- 

HOMOLOGATION:
- 
```

This envelope is the minimum contract between the orchestrator and an implementation agent.
