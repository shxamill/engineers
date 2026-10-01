---
name: standards-security-sensitive
description: Security standards for auth, sessions, crypto, payments, webhooks, uploads, secrets; requires security review.
user-invocable: false
paths:
  - "**/*{auth,login,signup,session,token,jwt,oauth,password,crypto,permission,rbac,acl,payment,billing,checkout,webhook,upload}*"
  - "**/*{auth,payment,payments,billing,security,admin}*/**"
  - "**/.env.example"
---
# Security-sensitive code
This file sits on a security boundary: `/engineering-os:eng-secreview` is mandatory before merge, whatever the change size. Security acceptance criteria cite OWASP ASVS 5.0 IDs (L1 default, L2 for sensitive features).
- Use vetted libraries; never roll your own crypto, token format, or password hashing (argon2id, or bcrypt with an appropriate cost).
- Sessions/tokens: short-lived, rotated, revocable; cookies `HttpOnly; Secure; SameSite`; CSRF protection for cookie auth.
- Compare secrets in constant time. Lockout or rate-limit authentication attempts. Generic auth error messages.
- Authorization is deny-by-default and checked server-side on every request and object.
- Webhooks: verify signatures, reject replays (timestamp + id), process idempotently.
- Payments: amounts and prices come from the server, never the client; idempotency keys; reconcile against the provider.
- Uploads: allowlist types, check magic bytes, enforce size limits, store outside the web root, randomize names.
- Audit-log privileged actions (who, what, when), without secrets.
- Secrets only from env or a secret manager; `.env.example` holds placeholders only.
