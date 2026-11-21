// The traps a change triggers (docs/verification-practices-study.md §2.6).
//
// The traps of this repository were prose — in CLAUDE.md, in ci.yml's comments, in the release records —
// and prose is read once, then not at the moment it matters. scripts/diff-checklist.json gives each one a
// trigger read from the diff (path patterns), what to check, and where it came from. This prints only the
// items the change triggers — usually a few, not all of them — and runs the checks it can do itself (`auto`:
// a document changed without its .ja.md twin). On stdout, in the job summary and as notices; observe mode,
// it always exits 0.
//
//   node scripts/diff-checklist.mjs --base <ref> [--head <ref> | --worktree]
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = opt('--base') ?? process.env.BASE_SHA;
if (!base) {
  console.error('[diff checklist] needs --base <ref> (or BASE_SHA)');
  process.exit(1);
}
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const changed = (args.includes('--worktree')
  ? [...git('diff', '--name-only', base).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')]
  : git('diff', '--name-only', base, opt('--head') ?? 'HEAD').split('\n')).filter(Boolean);
const changedSet = new Set(changed);

/** The checks the script runs itself; each returns what it found (empty: nothing). */
const AUTO = {
  pair(files) {
    const found = [];
    for (const f of files) {
      const twin = f.endsWith('.ja.md') ? f.replace(/\.ja\.md$/, '.md') : f.replace(/\.md$/, '.ja.md');
      if (twin === f || changedSet.has(twin) || !existsSync(join(ROOT, twin))) continue;
      // (a deleted file's twin is reported too: it should go, or say why it stays)
      found.push(`${f} changed, ${twin} did not`);
    }
    return found;
  },
};

const { items } = JSON.parse(readFileSync(join(ROOT, 'scripts/diff-checklist.json'), 'utf8'));
const hits = [];
for (const item of items) {
  const res = item.paths.map((p) => new RegExp(p));
  const files = changed.filter((f) => res.some((re) => re.test(f)));
  if (files.length === 0) continue;
  if (item.auto) {
    const found = AUTO[item.auto](files);
    if (found.length) hits.push({ item, files, found });
  } else hits.push({ item, files, found: [] });
}

const out = [];
if (hits.length === 0) out.push('### Checklist: nothing this change triggers', '');
else {
  out.push(`### Checklist: ${hits.length} item${hits.length === 1 ? '' : 's'} this change triggers (observe mode)`, '');
  for (const { item, files, found } of hits) {
    out.push(`- **${item.id}** — ${item.check}`);
    for (const f of found) out.push(`  - ${f}`);
    if (!found.length) out.push(`  - ${files.slice(0, 5).map((f) => `\`${f}\``).join(', ')}${files.length > 5 ? `, and ${files.length - 5} more` : ''}`);
    out.push(`  - (from: ${item.source})`);
  }
  out.push('');
}
const text = out.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
if (process.env.GITHUB_ACTIONS) {
  for (const { item, files } of hits) console.log(`::notice file=${files[0]}::checklist ${item.id}: ${item.check}`);
}
