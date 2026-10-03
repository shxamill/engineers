# Engineering records

This directory holds the Engineering OS project's **own** engineering state. It is kept the same way the OS asks product repositories to keep theirs. It records how the OS was built, decided, measured, and corrected. For how to *use* the plugin, see the [plugin manual](../../plugins/engineering-os/README.md).

| Record | What it holds |
|---|---|
| [`status.md`](status.md) | Current objective, phase, risks, assumptions, and next actions |
| [`release-process.md`](release-process.md) | Release gate, tag, GitHub Release, post-release verification, and rollback procedure |
| [`decisions.md`](decisions.md) | Decision log: ADRs and every process change (`PROC-n`), each with the evidence that caused it |
| [`adr/`](adr/) | Architecture decision records: [0001](adr/0001-engineering-organization.md) (V1 organization), [0002](adr/0002-engineering-os-v2.md) (V2 plugin), [0003](adr/0003-engineering-os-v3.md) (V3), [0004](adr/0004-evaluation-model.md) (evaluation model) |
| [`v3-research.md`](v3-research.md) | V3 research: Claude Code capabilities verified against current docs, agentic engineering, engineering organizations, security, and the measured experiments E-1..E-4 |
| [`v3-audit.md`](v3-audit.md) | Principal-engineer audit of V2 that drove V3 (36 findings, P0–P2) |
| [`v3-architecture.md`](v3-architecture.md) | V3 architecture: layers, routing, lifecycle gates, task model, evidence model, security boundary, telemetry |
| [`v3-migration.md`](v3-migration.md) | Upgrading a product repository from 2.x to 3.0.0 |
| [`reviews/`](reviews/) | Independent reviews: [V3 fresh-context review](reviews/v3-fresh-review.md) (20 defects, dispositions, regression tests) |
| [`v2-audit.md`](v2-audit.md) | Principal-engineer audit of V1 that drove V2 (25 findings) |
| [`research.md`](research.md) | V1–V2 sourced findings on the Claude Code platform, agentic engineering practice, engineering organizations, and documentation practice, with confidence levels (continued in `v3-research.md`) |
| [`benchmarks/`](benchmarks/) | Benchmark reports: [run 1](benchmarks/v2-run1.md), [run 2 and targeted re-run](benchmarks/v2-run2.md), [V3 run 1](benchmarks/v3-run1.md) (invalid: usage limit), [V3 run 2](benchmarks/v3-run2.md) (first valid two-arm run) |
| [`retrospectives/`](retrospectives/) | [0001](retrospectives/0001-bootstrap-validation.md) (V1 bootstrap validation), [0002](retrospectives/0002-v2-benchmark.md) (V2 benchmark lessons) |
