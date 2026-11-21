---
name: verify
description: Run what CI would check for the change in this wcstack checkout — the affected packages' lint and tests (quick), or build, the state gates, typecheck and coverage too (heavy) — and say what was run in the commit. Use before committing, before opening a pull request, and on a branch with no pull request to main (research/*, release/*), where ci.yml does not run.
---

# verify

CI selects the packages a change affects and runs each one's checks. `scripts/verify.mjs` holds that selection — ci.yml's `detect-changes` calls it — so running it here checks what CI would.

## Steps

1. **Quick tier, before each commit** (seconds to a few minutes):
   ```bash
   node scripts/verify.mjs --base main --worktree
   ```
   It runs `npm run lint` and `npm test` in each selected package. To see the selection only, add `--list`.
2. **Heavy tier, before a pull request** (what CI's package job runs):
   ```bash
   node scripts/verify.mjs --base main --worktree --heavy
   ```
   It runs lint, build, the `@wcstack/state` size and coupling gates, typecheck and `test:coverage`. A committed `dist` that the build rewrote is put back, as long as it was clean before (dists are rebuilt only at a release).
3. **When the change touches a page, an example or a package's runtime**, run the e2e suite over the built dists. Build the affected packages first, then put their dists back:
   ```bash
   cd e2e && npx playwright test --project=chromium
   ```
4. **When the change touches a gate input** (a baseline, a gate script, coverage thresholds, the e2e config, a workflow):
   ```bash
   node scripts/gate-changes.mjs --base main --worktree
   ```
   Name the decision behind it in the pull request.
5. **Put the `Verified:` line it prints in the commit message**, e.g. `Verified: quick (passed) state, devtools, router @ 1a2b3c4+changes`. On a branch without CI, that line is the record of what was run.

## When a step fails

Fix the cause. Do not re-run until it passes, and do not skip or loosen the check. If a test fails only sometimes, find out why: it may be a defect that the e2e retries were hiding (docs/verification-practices-study.md §2.4). If you cannot find a cause, delete the test and write down why.
