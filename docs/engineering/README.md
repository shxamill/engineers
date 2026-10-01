# Engineering records

This directory holds the Engineering OS project's **own** engineering state. It is kept the same way the OS asks product repositories to keep theirs. It records how the OS was built, decided, measured, and corrected. For how to *use* the plugin, see the [plugin manual](../../plugins/engineering-os/README.md).

| Record | What it holds |
|---|---|
| [`status.md`](status.md) | Current objective, phase, risks, assumptions, and next actions |
| [`decisions.md`](decisions.md) | Decision log: ADRs and every process change (`PROC-n`), each with the evidence that caused it |
| [`adr/`](adr/) | Architecture decision records: [0001](adr/0001-engineering-organization.md) (V1 organization), [0002](adr/0002-engineering-os-v2.md) (V2 plugin) |
| [`v2-audit.md`](v2-audit.md) | Principal-engineer audit of V1 that drove V2 (25 findings) |
| [`research.md`](research.md) | Sourced findings on the Claude Code platform, agentic engineering practice, engineering organizations, and documentation practice, with confidence levels |
| [`benchmarks/`](benchmarks/) | Benchmark reports: [run 1](benchmarks/v2-run1.md), [run 2 and targeted re-run](benchmarks/v2-run2.md) |
| [`retrospectives/`](retrospectives/) | [0001](retrospectives/0001-bootstrap-validation.md) (V1 bootstrap validation), [0002](retrospectives/0002-v2-benchmark.md) (V2 benchmark lessons) |
