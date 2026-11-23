# Verification practices from the Claude Code team — a study

- **Status**: study, 2026-11-21. The author took the recommended order the same day (§3). §4 records the work as it lands.
- **Source**: Addy Osmani, [How the Claude Code team thinks about verification](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/) (2026-11-16), called *the article* below.
- **日本語版**: [verification-practices-study.ja.md](./verification-practices-study.ja.md)

The article describes how a team that has Claude write and review most of its code keeps that code honest. Its practices are checks the change cannot edit, hooks for failures that repeat, and a `verify` skill run before each commit. It forbids retrying a flaky test until it passes. It adds property and differential tests, checklists triggered by the diff, rules pruned as they age, and a review loop that stops after three rounds. Eight proposals were drawn from it for wcstack. This document checks each proposal against the repository, records the verdict, and sets the order of the work.

## 1. What the article says

- "If a change can modify the check that judges it, the check is broken." Code Review reads REVIEW.md from the base branch, never from the pull request.
- When an agent repeats a failure, add a hook or an explicit rule in CLAUDE.md, which "(mostly)" stops it.
- Verification means running the change. A `verify` skill in `.claude/skills/` is used before committing and kept fast and reliable. A hook runs the tests when Claude finishes. Each commit is stamped with how it was verified, "none" included. A new gate starts in observe mode and logs what it would have blocked.
- Flaky tests teach the agent to rerun rather than fix. Claude cannot skip them, add sleeps or retry until they pass. If it finds no root cause, it deletes the test and writes down why.
- Property tests cover round trips, invariants, idempotency, and optimized code against naive code. Differential tests run old against new on random or sampled inputs, normalize the differences that do not matter, and keep a list of approved changes.
- A reliability checklist gives each item a trigger read from the diff, a check, and the incidents behind it. Only the matching items run, usually 3 to 10.
- "Test suites, verification steps and .md files only grow if you let them": prune them.
- Use one reviewer. Each round carries the earlier rounds and past failures, findings are tagged Important / Nit / Pre-existing, and REVIEW.md says what to look at. A check still failing after three rounds goes to a human.

## 2. The proposals against the repository

| # | Proposal | Verdict | Priority |
|---|---|---|---|
| 1 | Gates out of the change's reach | sound, but done differently | high |
| 2 | The skill's lint gate as a hook | sound; half its premise is already fixed | medium |
| 3 | A verify script and skill outside CI | sound | medium |
| 4 | `failOnFlakyTests` on the e2e retries | right direction, but cannot be turned on yet | first: investigate |
| 5 | Property and differential tests for the state engine | sound | high for (a) |
| 6 | "Things that bite" as a diff-triggered checklist | sound | low to medium |
| 7 | No changing numbers in prose | sound and confirmed | first: cheap |
| 8 | The project-quality-improvement skill | sound; partly describes an old version | medium |

### 2.1 Gates out of the change's reach

**Proposal.** The PR a gate judges can change all of the gate's inputs: the size and coupling baselines (slack included), the absolute limits in `check-state-size.mjs`, each `vitest.config.ts` threshold, the coverage-exclusion comments in `src`, and `ci.yml` itself. A `gate-integrity` CI job fails a PR that touches them without a `Gate-Change:` trailer. A PreToolUse hook refuses the agent's edits to them and `--update`.

**The repository.** This is right in substance. Since the 4.0 gates were rebuilt (2026-10-03), the size baseline has changed in 65 commits. 17 of them were not release re-recordings: add-ons added or moved, diagnostics grown, a 640 B slack "until the release re-records it" (bd9c6944), and the core limit raised to 20 KiB (49dc2770). Each was the author's decision, so the gate should make such a change visible, not forbid it. The 21 coverage-exclusion comments sit in 10 files of six packages; `state` has none.

**Where it falls short.** A trailer is self-declared, so an agent stuck at a gate can write it as easily as the code. In the article, the rules come from the base and not from the change.

**To do.**
- CI: also judge the PR by the base's rules — the base's copy of the size gate, limits and baseline, over the PR's build. Write a change to the baselines, the limits, the thresholds or the exclusion comments, with its diff, to the job summary. Start in observe mode.
- Agent: use a permissions `ask` rule, not a PreToolUse deny. The agent re-records the baselines with `--update` as part of the release procedure, and a deny would stop the release. Writes through Bash (sed, node) are not covered, so this is a speed bump, not a wall.

### 2.2 The skill's lint gate as a hook

**Proposal.** The plugin's `hooks/hooks.json` runs `wcs-validate` after the agent writes HTML, a manifest or a state source (PostToolUse). A Stop hook blocks finishing while an error is left. Errors block; warnings come back as information.

**The repository.** In the family-ledger run, `--errors-only` let 4 real warnings through. 4.21 fixed that: `wcs/submit-without-prevent` and `wcs/tag-package-missing` became errors (#659), and the skill's pass line became "`--errors-only` exits 0 and every warning is fixed or explained". The authors who ran the lint in 0 of 9 cold-start runs had no skill. A plugin hook reaches only authors who installed the plugin, and only in Claude Code.

**To do.** The plugin is active in every project, so limit PostToolUse to files that contain `data-wcs`, a `wcs-` tag or a wcstack script. Never block when the lint cannot run (offline, or the first `npx` download). The Stop hook checks `stop_hook_active` and lets the stop through after two blocks, as the article's commit gate does. Start in observe mode and measure with the cold-start probe that static-wiring-dx D10 plans.

### 2.3 A verify script and skill outside CI

**Proposal.** Move CI's selection logic into `scripts/verify.mjs --base <ref>`, called from CI and from a `.claude/skills/verify/` skill. A quick tier (lint and the affected packages' tests) runs from a Stop hook; a heavy tier (the size and coupling gates, e2e, the exhaustive suites at CI depth) runs before a PR. A `Verified:` trailer records what ran.

**The repository.** The selection lives only in YAML bash. In `ci.yml`'s `detect-changes`, a change to `tsconfig.json` selects every package, `state` adds devtools and router, a member adds `wcstack`, and the gate scripts select `state`. `e2e.yml` decides which dists are stale. But `research/*` last moved on 2026-10-24, and releases run from main, so branches without CI are mostly in the past. What is still worth having is CI's selection run locally before a PR.

**To do.** Have the CI workflows and the skill call one script. Run the Stop hook only when `packages/` changed since the last verify, and without coverage: it fires at the end of every turn, conversation-only turns included. Tie the `Verified:` stamp to the tree it verified. Start in observe mode.

### 2.4 `failOnFlakyTests` on the e2e retries

**Proposal.** CI retries a failed e2e test twice (`e2e/playwright.config.ts`), and a test that passes on a retry counts as passed. A defect that fails a fraction p of attempts goes green with probability 1 − p³ (97 % at p = 0.3). Set `failOnFlakyTests: !!process.env.CI`. Keep the retries for diagnosis, but do not let them turn a run green.

**The repository.** Playwright 1.61.1 has the option. But 8 of the 15 latest e2e runs (2026-11-15 to 11-19) had flaky tests, 10 in all:

| Spec | Runs | The first attempt |
|---|---|---|
| `family-ledger.spec.ts` | 5 | the login helper's URL is `/login?email=…&<password>`: the form went out as a GET |
| `router-auth.spec.ts` | 1 | the same: `/login?username=alice&<password>` |
| `homeroom.spec.ts` | 1 (2 tests) | still on `/login?next=…` after logging in |
| `town-archive.spec.ts` | 1 | the card is not focused after "back to the list" |
| `state-mount.spec.ts` V7 | 1 | the volume's `$connectedCallback` did not run |

Turning the option on now would turn about half of the PRs red, and the article's warning applies. In two apps the login form went out as a native GET with the password in the URL, which looks like a submit that came before the page was bound. A slow network could do the same to a real user. V7 might be an engine timing defect. §2.4.1 records what the investigation found.

**To do.** (1) Find each spec's root cause, then fix it, or delete the test and write down why. (2) Write the flaky count to the job summary (observe mode). (3) Turn on `failOnFlakyTests` once the count stays at 0, and add one line to CLAUDE.md.

#### 2.4.1 What the flaky specs hid (2026-11-21)

Of the five specs, one was a test bug. The other four hid two defects in wcstack. A user can meet both, and neither says anything.

| Spec | Root cause | How it was reproduced |
|---|---|---|
| `state-mount.spec.ts` V7 | **Test bug.** The test waited for the root's `connectedCallbackPromise`, then read the volume. A volume loads its own `src` and settles on its own promise; the root does not wait for it (the state README, Volumes). | With the volume's `src` delayed by 800 ms, the test reads `undefined` every time. Fixed: it waits for both. |
| `family-ledger`, `router-auth`, `homeroom` | **A route is usable before state binds it.** The router draws `/login` as soon as its script runs. state binds it once the root state has loaded (`state.js`, or an inline module). A submit in between goes out as a native GET, with the password in the URL and the history. Text typed in between is erased when the binding writes the state's empty value; `homeroom`'s `required` fields then stop the submit. The SSR add-on already gives typed text back (`typed()`, the author's decision in v4-direction §5.1). A page the client draws has nothing like it. | With `state.js` delayed by 1.5 s, family-ledger's login goes to `/login?email=mom%40example.com&password=pass` every time, and the typed values of both apps become `""`. Without the delay, nothing goes wrong. |
| `town-archive` | **An outer binding hears an inner element's event.** `<wcs-intersect>` dispatches bubbling events, as most I/O nodes do (42 Core files). The element itself ignores a descendant's event (`event.target !== this`), but state's `eventToken.*` and output-property listeners (`dom/wc.ts`) do not check the target, and neither does signals' `bindNode`. The outer seen-probe's `cardVisibility` also ran for the inner thumb-probe, and recorded `span.thumb` as the card. `focusCard` then found no `.card-link` in it. Seen counts and the anchor read the same wrong entries. | 3 of 30 local runs. A temporary trace showed `span.thumb` in `rt.cardEls` on every failure and `article.card` on every pass. |

The two defects need the author's decisions before they are fixed. Until then, their specs stay flaky, and `failOnFlakyTests` waits for them.

### 2.5 Property and differential tests for the state engine

**Proposal.** (a) Random state shapes and write sequences, list operations included: the DOM after the dirty strategy and the keyed diff must equal the DOM from re-evaluating every binding. (b) The frozen 3.5.4 parser against the 4.0 parser on generated `data-wcs` strings, with the known differences (`@state`) on an approved list. (c) Round trips through the router's `encodePathname` / `decodeSegment`, `protocol/input-attribute` and the SSR snapshot.

**The repository.** fast-check is used only in signals (`reactive.property.test.ts`). The state tests generate nothing at random; `Math.random` appears only to name tags in `bench/scale`.

**To do.**
- (a) The oracle does not have to be a separate naive evaluator. Have a fresh `<wcs-state>` draw the same final state, and compare its DOM, normalized, with the incrementally updated one. fast-check is a devDependency, so the zero-runtime-dependency rule holds (signals did the same).
- (b) The fixture has 3.5.4's `parser.esm.js`. But the 4.0 parser is a port with goldens, so (b) is worth less than (a).
- (c) Write the law with care. `encodePathname` and `decodeSegment` are not inverses: static segments match as written (#694). The law is that a path the app writes reaches the route it means, and its params come back decoded.

### 2.6 "Things that bite" as a diff-triggered checklist

**Proposal.** Give each trap a trigger read from the diff, a check, and the incident behind it, and run only the matching items. The incidents are already in the CI comments (#183, #433, #136, #214–#219, #591). Some traps live only in prose: the README / README.ja pair, the wcstack-skill references, the chunk renamed by a `packages/state/package.json` edit, and the testing build that dirties the dists. The README pair and a `Skill-Impact:` trailer can be checked by machine, in observe mode.

**To do.** A check that warns when one README of a pair changes without the other (`packages/wcstack` has an English README only). Moving the traps out of CLAUDE.md into a triggered checklist also shrinks what every session reads. The skill lives in another repository, so a `Skill-Impact:` trailer only records.

### 2.7 No changing numbers in prose

**Proposal.** The mistake catalogue gives the core 536 B of room under the 20 KiB limit. The real room is 6 B, and the disposition definition uses that room to decide where a runtime report goes.

**The repository.** Confirmed. 536 B stands in `docs/mistake-catalogue.md` (the disposition definition, and the `submit-without-prevent` row), the same two places in the `.ja.md`, their source `scripts/mistake-catalogue.json`, and `docs/v4-direction-2026-10.md` (two lines of the 2026-10-17 policy). Dated decision records — "20,163 B (4.7.0)" in the same document's §5 — are history and stay.

**To do.** Remove the number from definitions and policy, and say where the current figure is: the size gate's output, quoted in CLAUDE.md. Removing the number is cheaper than injecting it from the baseline: the number changes at every release, and only the gate needs it.

### 2.8 The project-quality-improvement skill

**Proposal.** The loop between the reviewer and the fixer has no limit. The reviewer runs no build, test or lint. Each pass rescans from a blank context. Carry the earlier rounds forward, or at least a ledger of the findings the fixer rejected. Tag findings Important / Nit / Pre-existing. Put the review's focus in a wcstack REVIEW.md.

**The repository.** The skill is user-level (`~/.claude/skills/`), not in this repository. The proposal reads an old version: the current one starts a fresh reviewer agent (at most 5) instead of `/clear`. The inner loop (steps 3 to 6) has no limit, and it can run forever. The fixer rejects a finding, the same reviewer returns it as unresolved, and "no findings" never comes. Each fresh reviewer raises the rejected finding again. Neither the reviewer nor the fixer is told to run the build, the tests or the lint; the fixer only "considers the effect on tests". Pre-existing means "not introduced by this diff". Under a full-source scan everything is pre-existing, so the tag separates nothing; Important / Nit does separate.

**To do.** Stop after 3 rounds and hand the rest to a human. Have the fixer run the build, the tests and the lint, and attach the results. Carry a ledger of rejected findings, with the reasons, to each fresh reviewer. Tag findings Important / Nit. Read the repository's REVIEW.md when it has one.

## 3. Order of work

Decided 2026-11-21 (the author took the recommended order):

1. §2.7: a few lines, and the error is confirmed.
2. §2.4's investigation: the flaky specs may hide defects (the login GET, V7).
3. §2.1: the `ask` rules and judging by the base's rules.
4. §2.5 (a).
5. §2.8: the user-level skill.
6. §2.3, then §2.2 (with D10), then §2.6.

Each new gate starts in observe mode, as the article says, and enforces once its false positives are known.

### 3.1 Decisions taken along the way (2026-11-21, the author, each as recommended)

1. **A submit made before binding is made again** (#724). Stopping it alone would leave the first click during loading doing nothing, and the e2e login helpers flaky. After the typed values are back, the form is submitted with the button that was pressed. Disabling the button while sending prevents a second submit. Recorded in v4-direction §5.22. Compared: stop only (the decision as first written); stop and warn in diagnostics (only the developer hears it).
2. **No Stop hook that runs tests at the end of a turn, for now** (§2.3). PRs to main always get CI, and the branches without CI are rarely used. A Stop hook would cost minutes at the end of every turn that changed `packages/`. Revisit it in observe mode if the observe gates show commits going in untested. Compared: observe, which reports and does not block; enforce, which refuses the stop and lets the third through.
3. **The forms add-on's 640 B slack (#724) is removed when the release re-records the baselines.** A slack survives `--update`, so #728's checklist reminds whoever changes the baseline. Compared: re-record the entry now (an unreleased number in the baseline); keep the slack (a gate loosened by 40 % of the add-on for good).
4. **`failOnFlakyTests` is turned on once #722, #723 and #724 have landed and the job summary has shown 0 flaky tests for 10 runs in a row.** Compared: at once after the three land (an unknown flaky spec would block unrelated PRs); never (the retries keep turning defects green).

Later, by the same rule:

- The observe gates (#725's `gate-changes` and the base's size gate, #728's checklist) get a decision after about 10 PRs. `gate-changes` could fail a PR whose description names no decision. The checklist stays advice by nature.
- The skill's lint hooks (wcstack/wcstack-skill#74) become enforcing by default only after static-wiring-dx D10's cold-start probe.

## 4. Progress

#721–#729 were merged on 2026-11-23, in order. On the first e2e runs after the merges, the flaky summary reported one flaky test, lending-desk's pager. It was a race in the test, fixed in #730. `failOnFlakyTests` waits for 10 runs in a row with 0 flaky tests (§3.1).

| Step | Section | State |
|---|---|---|
| 1 | §2.7 | done with this document (#721) |
| 2 | §2.4 | the root causes found (§2.4.1); the observe-mode reporter and the V7 fix in #722; the two defects decided (v4-direction §5.22) and fixed in #723 (nested events) and #724 (forms before binding); `failOnFlakyTests` waits for those to land and the count to stay at 0 |
| 3 | §2.1 | #725: `gate-changes` (CI job and script), the base's size gate over the PR's build, `ask` rules in `.claude/settings.json` — all observe mode |
| 4 | §2.5 | (a) #726: the property over random writes, against a fresh render; it caught a deliberately broken keyed diff in three writes. (b) #726: the parser against the frozen 3.5.4 one, 2,500 generated texts, no difference. (c) #729: the router's path laws (fast-check) and the input-attribute rules (bounded exhaustive, in all 33 copies); each caught a deliberately broken variant the example tests let through |
| 5 | §2.8 | done in the user-level skill (outside the repository): 3 rounds, the fixer runs build / test / lint, a ledger of rejected findings, Important / Nit, the repository's REVIEW.md |
| 6 | §2.3, §2.2, §2.6 | §2.3 #727 (`scripts/verify.mjs`: CI's package selection, the same as the bash for 300 merges, and e2e.yml's stale dists, the same for 24 commits; `--e2e` runs the suite as the workflow does; a Stop hook left to the author); §2.2 wcstack/wcstack-skill#74 (the plugin's lint hooks, observe by default; enforce after D10); §2.6 #728 (`scripts/diff-checklist.json`, 10 items) |
