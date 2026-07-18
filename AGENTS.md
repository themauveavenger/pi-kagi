# AGENTS.md

- Before declaring any turn complete where you wrote code, all tests, if they exist, must be passing, and `npm run typecheck` MUST NOT produce any type errors. Failing tests and type errors MUST be fixed before ending your turn.

## Agent skills

### Issue tracker

Local markdown — issues live as files under `docs/planning/<feature>/`, committed to git. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` at the repo root and ADRs under `docs/adr/`. See `docs/agents/domain.md`.