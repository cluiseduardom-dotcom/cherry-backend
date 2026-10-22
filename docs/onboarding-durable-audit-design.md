# Durable audit design for privileged tenant provisioning

## Status

Design checkpoint only. This document does not enable provisioning, change runtime behavior, or authorize production database writes.

## Why structured logs are not enough

The current onboarding middleware can record credential decisions to application logs. Those logs are operational signals, not a durable business/security audit trail. A shared secret also proves possession of a credential but does not identify the human or service operator.

## Required audit event

The durable audit record should contain only bounded, non-secret metadata:

- event ID and UTC timestamp;
- outcome (accepted, rejected, provisioning_succeeded, provisioning_failed);
- reason code from an allow-list;
- authenticated operator/service identity and credential key ID (never the credential);
- request correlation ID;
- tenant ID only after a successful commit;
- environment and source IP where legally and operationally justified.

Never persist passwords, password hashes, JWTs, onboarding secret values, full request bodies, or unnecessary personal data.

## Proposed storage

Add an append-only onboarding_audit_events table through a reviewed migration. Restrict INSERT to the provisioning service and SELECT to authorized security/operations roles. Do not provide UPDATE/DELETE through application routes. Define retention, backup, access review, and incident-export procedures before production use.

Audit events for a successful tenant creation should be written transactionally with tenant creation where feasible. For failed authorization attempts, use a separate bounded audit sink because no tenant transaction exists; protect it against request floods and avoid letting audit-storage outages accidentally authorize a request. Never log a credential to recover from an audit write failure.

## Operator identity and credential model

Before implementation, choose one:

1. Authenticated superadmin identity with MFA and explicit permission to provision tenants; or
2. A trusted server-to-server operator service using a unique credential per caller, rotation, a credential key ID, and a separately attributable human approval trail.

Do not embed any provisioning credential in browser code or ship it to tenant clients. Do not use a tenant-scoped admin role as a platform superadmin.

## Provisioning response

The current flow returns a JWT and accepts a chosen initial password. Replace it before broad operational use with an invitation or one-time setup flow, short-lived single-use token, forced password setup, and no reusable token in ordinary logs. The one-time token must be hashed at rest, expire, be single-use, and be invalidated after completion.

## Required tests and rollout gates

- Authorized and unauthorized operator identity;
- missing, expired, revoked, and rotated credential;
- no secret/token/password in logs or audit rows;
- append-only access restrictions and retention;
- successful provisioning and audit record consistency;
- rollback on any tenant/default/admin creation failure;
- audit storage outage fails closed for provisioning but does not expose secrets;
- rate limiting and request correlation;
- isolated staging database integration tests;
- explicit review of migration permissions and backup/restore.

## Rollout sequence

1. Keep the current shared-secret guard fail-closed.
2. Review the operator identity and one-time setup decision.
3. Implement schema and service with tests.
4. Run integration tests against a disposable homologation database.
5. Verify staging configuration without exposing secret values.
6. Only after explicit approval, deploy to staging and validate.
7. Production rollout requires a separate reviewed change and confirmed rollback plan.
