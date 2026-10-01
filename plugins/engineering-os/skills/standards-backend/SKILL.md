---
name: standards-backend
description: "Backend standards: contracts, validation, object-level authZ, injection, SSRF, timeouts, idempotency, logging."
user-invocable: false
paths:
  - "**/{api,server,routes,router,controllers,handlers,services,middleware,resolvers,workers,jobs}/**"
  - "**/{server,app,main,index}.{js,ts,mjs,cjs}"
  - "**/*.{py,go,java,kt,rb,rs,cs,php}"
---
# Backend rules
- Contract-first: match `architecture.md` request/response/error shapes; changing a contract is a decision, not a refactor.
- Validate every external input at the boundary with a schema; reject unknown, oversized, or malformed input.
- Authenticate, then authorize **each object access** (no IDOR). Deny by default.
- Parameterized queries/ORM only. No shell execution with user input (use argument arrays, never string commands).
- Outbound requests built from user input go through an allowlist (SSRF).
- Every outbound call has a timeout. Retry only idempotent operations, with backoff + jitter. Idempotency keys for webhooks and payments.
- Errors: one consistent shape; no stack traces, SQL, or internals in responses.
- Structured logs with request id; never log secrets, tokens, passwords, or PII.
- Config from env vars; fail fast at startup when required config is missing.
- Rate-limit auth and expensive endpoints.
