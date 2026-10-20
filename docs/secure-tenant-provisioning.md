# Secure tenant provisioning — design and rollout

Status: design proposal for Issue #102. This document does not enable or change production behavior.

## Current state

- `POST /onboarding` is protected by `ONBOARDING_SECRET` outside explicit `development` and `test` environments.
- The secret is checked server-side; it must never be embedded in browser code.
- If the secret is missing in staging/production, the route returns 503. If the request header is absent or wrong, it returns 401.
- The onboarding service creates a company, default sales channels, financial/SKU configuration and an admin user in one database transaction.
- The service currently accepts a plaintext admin password in the request and returns an access token. The production workflow must not put credentials in source control, tickets, logs, or browser-delivered code.
- No frontend callsite or superadmin provisioning UI was identified during the repository search. External callers must be confirmed before any operational change.

## Recommended first release

Use a trusted server-to-server/operator workflow, not a public self-registration form.

1. Keep the existing server-side secret guard as a temporary service credential boundary.
2. Invoke onboarding only from an operator-controlled environment (for example, a local secured terminal or a future private admin service). Never expose `ONBOARDING_SECRET` to Vite/React or any browser bundle.
3. Generate the secret using a cryptographically secure random generator and store it only in the Render environment and the trusted caller's secret manager/environment. Do not put the value in GitHub, issue comments, shell history, or logs.
4. Before enabling any caller, confirm whether `ONBOARDING_SECRET` exists on each Render service without printing its value. Configure staging and production separately.
5. Replace the plaintext-password-and-token onboarding response with an invitation or one-time setup flow before general customer self-service. Until then, use only a controlled operator flow and deliver credentials through an approved secure channel.
6. Add an audit event for successful and rejected provisioning attempts. Do not log the secret, request password, access token, or full sensitive request body.
7. Retain the strict rate limit and ensure proxy trust configuration is correct.

## Implementation sequence

### Phase A — contract and tests
- Add tests proving production/staging fail closed when the secret is absent.
- Test missing, incorrect and correct `X-Onboarding-Secret` values.
- Ensure invalid payloads never call the provisioning service.
- Ensure duplicate email returns conflict and transaction rollback leaves no partial tenant.
- Verify the integration suite only uses a disposable isolated database.

### Phase B — operator provisioning client
- Add a small Node CLI or private server-side client that reads the API URL and secret from environment variables only.
- Prompt for non-secret company/admin fields interactively; read the initial password without echo if password-based setup remains temporarily necessary.
- Send the secret only as `X-Onboarding-Secret` over HTTPS.
- Do not print response tokens or secrets; ideally do not request/return a login token for operator provisioning.
- Add a dry-run/confirmation step and clear protection against production being selected accidentally.

### Phase C — stronger admin model
- Design a real GiroOne superadmin identity with separate authorization from tenant-level `admin`.
- Store auditable provisioning events and actor identity.
- Prefer expiring invitation links / forced password setup over sending or storing an initial password.
- Require explicit review before making this available through a web interface.

## Safe rollout gates

- Never test tenant creation against the production database.
- Use an isolated homologation database and a distinct staging secret.
- Confirm the deployed commit and staging configuration before test execution.
- Test unauthenticated and invalid-secret requests return 401 (or 503 when unconfigured) and do not write rows.
- Test an authorized staging request creates exactly one tenant and all expected defaults; test duplicate attempts and rollback.
- Do not merge a production-enabling change until CI passes and the homologation result is reviewed.
- Do not create a production tenant as part of this task.

## Operational note

The presence or absence of `ONBOARDING_SECRET` cannot be inferred from application startup logs. Check configuration metadata without revealing values. If no trusted caller exists yet, do not configure a secret merely to make the endpoint return a different status; first implement and validate the caller.
