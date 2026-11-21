// What a change does to the gates that judge it (docs/verification-practices-study.md §2.1).
//
// "If a change can modify the check that judges it, the check is broken." In this repository a pull request
// can change every input of its own gates: the state size and coupling baselines (a slack included), the
// limits and rules in the gate scripts, each package's coverage thresholds, a coverage exclusion in a
// source file, the e2e retry policy and the workflows themselves. Such a change is often right — a new
// add-on needs a baseline entry, a release re-records the baselines — but it is the author's decision, and
// it must be seen. This lists what a change touches in them: on stdout, in the job summary
// ($GITHUB_STEP_SUMMARY) and as notices on the files. Observe mode: it always exits 0.
//
//   node scripts/gate-changes.mjs --base <ref> [--head <ref>]     (CI: --base "$BASE_SHA")
//   node scripts/gate-changes.mjs --base main --worktree          (before committing: the working tree)
//
// The state job of CI also runs the base's size gate over the pull request's build (ci.yml), so a change
// that passes only by moving its own limits shows there.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const base = opt('--base', process.env.BASE_SHA);
if (!base) {
  console.error('[gate changes] needs --base <ref> (or BASE_SHA)');
  process.exit(1);
}
// the refs `git diff` compares: base..head, or base and the working tree
const range = args.includes('--worktree') ? [base] : [base, opt('--head', 'HEAD')];
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The inputs of the gates, and what each one is. */
const GATES = [
  [/^scripts\/state-(size|coupling)-baseline\.json$/, 'a baseline of the state gates'],
  [/^scripts\/check-state-(size|coupling)\.mjs$/, 'a state gate: its limits and rules'],
  [/^packages\/[^/]+\/vitest\.config\.ts$/, "a package's coverage thresholds"],
  [/^e2e\/playwright\.config\.ts$/, 'the e2e retries and flaky policy'],
  [/^\.github\/workflows\/[^/]+\.ya?ml$/, 'a CI workflow'],
  [/^scripts\/gate-changes\.mjs$/, 'this list'],
  [/^\.claude\/settings\.json$/, "the agent's permission rules (it asks before editing these inputs)"],
];

const touched = [];
for (const file of git('diff', '--name-only', ...range).split('\n').filter(Boolean)) {
  const gate = GATES.find(([re]) => re.test(file));
  if (gate) touched.push({ file, what: gate[1] });
}

// coverage exclusions added to the packages' sources (a removed one makes the gate stricter: not listed)
const exclusions = [];
let file = null;
for (const line of git('diff', '-U0', ...range, '--', 'packages/*/src/*').split('\n')) {
  if (line.startsWith('+++ ')) file = line.startsWith('+++ b/') ? line.slice(6) : null;
  else if (file && line.startsWith('+') && /\b(v8|istanbul|c8)\s+ignore\b/.test(line)) exclusions.push({ file, text: line.slice(1).trim() });
}

const baselines = touched.filter((t) => t.what.startsWith('a baseline')).map((t) => t.file);
const out = [];
if (touched.length === 0 && exclusions.length === 0) {
  out.push('### Gate inputs: none touched', '');
} else {
  out.push('### Gate inputs this change touches (observe mode)', '');
  out.push("A change to what judges a change is the author's decision: say which one in the pull request (docs/verification-practices-study.md §2.1).", '');
  if (touched.length > 0) {
    out.push('| File | What it is |', '|---|---|', ...touched.map((t) => `| \`${t.file}\` | ${t.what} |`), '');
  }
  if (exclusions.length > 0) {
    out.push(`Coverage exclusions added: ${exclusions.length}`, '', ...exclusions.map((e) => `- \`${e.file}\`: \`${e.text}\``), '');
  }
  for (const b of baselines) {
    out.push(`<details><summary>${b}</summary>`, '', '```diff', git('diff', ...range, '--', b).trim(), '```', '', '</details>', '');
  }
}
const text = out.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
if (process.env.GITHUB_ACTIONS) {
  for (const t of touched) console.log(`::notice file=${t.file}::gate input changed: ${t.what}`);
  for (const e of exclusions) console.log(`::notice file=${e.file}::coverage exclusion added: ${e.text}`);
}
