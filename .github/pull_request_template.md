## Summary

<!-- What changed, and why? Keep this focused on the user or engineering outcome. -->

## Related issue

<!-- Use "Closes #123" when this PR fully resolves an issue. -->

## Scope

- [ ] Small and focused
- [ ] No unrelated refactor or cleanup included
- [ ] Changed files match the stated scope

## Validation

- [ ] Relevant tests/checks pass locally
- [ ] CI is expected to pass on Ubuntu and Windows where applicable
- [ ] Documentation updated when behavior, commands, counts, gates, or limitations changed
- [ ] No secrets or sensitive data added

## Engineering OS changes

Complete these when applicable:

- [ ] Hook change: added allow/deny coverage in `verify-hooks.mjs`
- [ ] Engine change: added/updated cases in `test-engines.mjs`
- [ ] New safety logic: added a mutation to `mutation-check.mjs`
- [ ] Behavior change: added an eval case
- [ ] Behavior change: recorded the process decision as `PROC-n`
- [ ] Plugin behavior change: bumped plugin version and updated `CHANGELOG.md`
- [ ] Architectural change: added/updated an ADR

## Evidence

<!-- List the commands you ran and the important results. Do not paste large logs. -->

```
node plugins/engineering-os/scripts/validate-org.mjs
node plugins/engineering-os/scripts/verify-hooks.mjs
node plugins/engineering-os/scripts/test-engines.mjs
claude plugin validate plugins/engineering-os --strict
claude plugin validate .
```

## Risk / rollback

<!-- What could break? How would we detect it? How would we roll it back? -->

## Reviewer notes

<!-- Anything the reviewer should pay particular attention to. -->
