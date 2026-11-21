// What CI would check for a change, run here (docs/verification-practices-study.md §2.3).
//
// CI's selection of packages lived only in ci.yml's bash; a branch with no pull request to main (research/*,
// release/*) got none of it, and an agent could not run what CI would run before opening one. This script
// holds the selection, and ci.yml's detect-changes job calls it (`--list --json`), so the two cannot drift:
//
//   - every packages/* whose package.json is named @wcstack/* (private ones too), and the unscoped `wcstack`
//     entry bundle (not the vscode-wcs extension);
//   - a change to the root tsconfig.json selects every package;
//   - otherwise a package is selected when a file under packages/<name>/ changed, and then:
//     - `wcstack` when one of its file:../ members changed: it inlines their dist/auto.min.js, so a member
//       change is what breaks it — a renamed tag fails its tag census, a member bundle that gained a static
//       import breaks the single-SRI-hash property — and without this the breakage first appeared in
//       release.yml's "Build all packages";
//     - `devtools` and `router` when packages/state/ changed (their suites run packages/state/src: devtools'
//       protocol drift test, router's routeRange.state test);
//     - `state` when only its gates or their baselines in scripts/ changed.
//
// Usage:
//   node scripts/verify.mjs --base <ref> [--head <ref> | --worktree] --list [--json]   the selection
//   node scripts/verify.mjs --base main --worktree                                       quick: lint + tests
//   node scripts/verify.mjs --base main --worktree --heavy                               + build, gates, coverage
//
// The quick tier runs `npm run lint` and `npm test` in each selected package. The heavy tier runs what CI's
// package job runs — lint, build, the state gates, typecheck, test:coverage — and puts back a committed dist
// the build rewrote (only one that was clean before). e2e is not run here: it prints the command. At the end
// it prints a `Verified:` line to put in the commit message, so a branch without CI says what was run.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(name);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The packages CI knows, in packages/* order. */
export function allPackages(root = ROOT) {
  const out = [];
  for (const dir of readdirSync(join(root, 'packages')).sort()) {
    const file = join(root, 'packages', dir, 'package.json');
    if (!existsSync(file)) continue;
    const name = JSON.parse(readFileSync(file, 'utf8')).name;
    if (name === 'wcstack' || name?.startsWith('@wcstack/')) out.push(dir);
  }
  return out;
}

/** The packages a list of changed files selects, in the order ci.yml's bash produced them. */
export function select(changed, root = ROOT) {
  const all = allPackages(root);
  if (changed.includes('tsconfig.json')) return all;
  const touches = (pkg) => changed.some((f) => f.startsWith(`packages/${pkg}/`));
  const selected = all.filter(touches);
  const deps = JSON.parse(readFileSync(join(root, 'packages/wcstack/package.json'), 'utf8')).devDependencies ?? {};
  const members = Object.values(deps).filter((v) => v.startsWith('file:../')).map((v) => v.slice(8));
  if (!touches('wcstack') && members.some(touches)) selected.push('wcstack');
  if (touches('state')) for (const pkg of ['devtools', 'router']) if (!selected.includes(pkg)) selected.push(pkg);
  if (changed.some((f) => /^scripts\/(check-state-[a-z]+\.mjs|state-[a-z]+-baseline\.json)$/.test(f)) && !selected.includes('state')) selected.push('state');
  return selected;
}

function changedFiles(base) {
  if (has('--worktree')) {
    const tracked = git('diff', '--name-only', base).split('\n');
    const untracked = git('ls-files', '--others', '--exclude-standard').split('\n');
    return [...new Set([...tracked, ...untracked])].filter(Boolean);
  }
  return git('diff', '--name-only', base, opt('--head') ?? 'HEAD').split('\n').filter(Boolean);
}

function run(pkg, script, results, extra = []) {
  const cwd = join(ROOT, 'packages', pkg);
  const scripts = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).scripts ?? {};
  if (!extra.length && !scripts[script]) return true;
  const cmd = extra.length ? extra : ['npm', 'run', script];
  const label = extra.length ? extra.join(' ') : `npm run ${script}`;
  process.stdout.write(`[verify] ${pkg}: ${label} … `);
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 256 * 1024 * 1024 });
  const ok = r.status === 0;
  console.log(ok ? 'ok' : `FAILED (exit ${r.status})`);
  if (!ok) console.log(`${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-40).join('\n'));
  results.push({ pkg, step: label, ok });
  return ok;
}

function main() {
  const base = opt('--base') ?? process.env.BASE_SHA;
  if (!base) {
    console.error('[verify] needs --base <ref>');
    process.exit(2);
  }
  const selected = select(changedFiles(base));
  if (has('--list')) {
    console.log(has('--json') ? JSON.stringify(selected) : selected.join('\n'));
    return;
  }
  if (selected.length === 0) {
    console.log('[verify] the change selects no package');
    return;
  }
  const heavy = has('--heavy');
  console.log(`[verify] ${heavy ? 'heavy' : 'quick'} tier for: ${selected.join(', ')}`);
  const results = [];
  for (const pkg of selected) {
    run(pkg, 'lint', results);
    if (!heavy) {
      run(pkg, 'test', results);
      continue;
    }
    const dist = `packages/${pkg}/dist`;
    const clean = git('status', '--porcelain', '--', dist).trim() === '';
    if (run(pkg, 'build', results) && pkg === 'state') {
      run(pkg, '', results, ['node', '../../scripts/check-state-size.mjs', '--check']);
      run(pkg, '', results, ['node', '../../scripts/check-state-coupling.mjs', '--check']);
    }
    run(pkg, 'typecheck', results);
    run(pkg, 'test:coverage', results);
    // a committed dist is rebuilt only at a release: put back what this build rewrote
    if (clean && existsSync(join(ROOT, dist))) {
      git('restore', '--', dist);
      git('clean', '-fq', '--', dist);
    }
  }
  const failed = results.filter((r) => !r.ok);
  const sha = git('rev-parse', '--short', 'HEAD').trim() + (git('status', '--porcelain').trim() ? '+changes' : '');
  console.log('');
  console.log(failed.length ? `[verify] ${failed.length} step(s) failed: ${failed.map((r) => `${r.pkg} ${r.step}`).join('; ')}` : '[verify] every step passed');
  if (heavy) console.log('[verify] e2e is not run here: cd e2e && npx playwright test --project=chromium');
  console.log(`Verified: ${heavy ? 'heavy' : 'quick'} (${failed.length ? 'FAILED' : 'passed'}) ${selected.join(', ')} @ ${sha}`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
