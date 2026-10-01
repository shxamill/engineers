---
paths:
  - "**/Dockerfile*"
  - "**/{docker-compose,compose}*.{yml,yaml}"
  - ".github/workflows/**"
  - "**/{infra,terraform,k8s,kubernetes,helm,deploy,ops,.circleci}/**"
  - "**/*.tf"
  - "**/{vercel,netlify,fly,render,railway}.{json,toml,yaml,yml}"
---
# Infrastructure & CI/CD rules
- Least privilege: CI jobs declare minimal `permissions:`; IAM roles scoped to exactly what is used.
- Pin third-party CI actions to a full commit SHA (with a version comment) and container images to a specific tag or digest.
- No secrets in files, images, or logs; use the platform's secret store. Never `echo` secrets in CI.
- CI order: install → lint → typecheck → test → build → deploy. Never deploy on red.
- Containers: multi-stage, minimal base, non-root user, `HEALTHCHECK`, `.dockerignore`.
- IaC: plan/diff before apply; review the plan; remote state, never committed.
- Production apply/deploy, IAM changes, and resource deletion need human approval (the bash guard enforces this).
- Every deploy has a rollback path written in `release-plan.md`.
