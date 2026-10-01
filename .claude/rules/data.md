---
paths:
  - "**/migrations/**"
  - "**/*.sql"
  - "**/{prisma,drizzle,alembic,db,database,models,schema,schemas,entities,repositories}/**"
  - "**/schema.prisma"
---
# Data & database rules
- Migrations are backward-compatible with the running code: expand → migrate/backfill → contract, across separate deploys.
- Every migration has a rollback path (down migration or documented restore). Test on a fresh DB and on a copy with existing data.
- Destructive changes (DROP, rename, type narrowing, data deletion) need a plan, and human approval for production.
- Integrity lives in the database too: NOT NULL, UNIQUE, FK, CHECK constraints; don't rely on application code alone.
- Index for real query patterns; check `EXPLAIN` for hot queries; no N+1 queries.
- Large tables: batched backfills, concurrent/online index creation, no long locks.
- Multi-step writes run in a transaction; choose isolation deliberately.
- PII columns are listed in `security.md`, with retention and deletion handled.
