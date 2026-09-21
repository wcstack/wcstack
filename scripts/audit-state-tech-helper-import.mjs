// What a helper-only import of @wcstack/state leaves after tree-shaking, before and after the
// wiring stages S1 / S2 (docs/state-next-major-wiring-design.md §8). The audit measured that
// re-exporting only `defineState` from the bundled index.esm.js keeps 26.8 KB gzip, because
// three feature modules registered themselves at evaluation and a bundler must keep everything
// they reach. "before" is the checked-in dist/index.esm.js (built from the release source);
// "after" is src/exports.ts built with the package's own Rollup config into memory. Both are
// then re-exported one name at a time, tree-shaken by Rollup and minified by terser, exactly
// as audit-state-next.mjs does. Nothing under the repository is written except the report.
// `--check [--max-gzip N]` is the CI gate of requirements N3 for the helper entry: it measures
// only the current source, writes no report, and exits 1 when the minified re-export of
// `defineState` alone exceeds N bytes gzip (default 1024).
// Run from the repository root after `npm ci` in packages/state:
//   node scripts/audit-state-tech-helper-import.mjs [--check] [--max-gzip N]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const pkg = join(root, 'packages/state');
const require = createRequire(join(pkg, 'package.json'));
const { rollup } = require('rollup');
const { minify } = require('terser');
const output = join(root, 'docs/research/state-next');
await mkdir(output, { recursive: true });
const size = code => { const b = Buffer.from(code); return { bytes: b.length, gzip: gzipSync(b, { level: 9 }).length,
  brotli: brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length }; };
const warnings = new Set();
const onwarn = w => warnings.add(`${w.code}: ${w.message}`);

process.chdir(pkg);
const configs = (await import(pathToFileURL(join(pkg, 'rollup.config.js')))).default;
const config = configs.find(c => c.output.file.endsWith('index.esm.js'));
const bundle = await rollup({ ...config, onwarn });
const fresh = (await bundle.generate({ format: 'esm', sourcemap: false })).output.find(o => o.type === 'chunk').code;
await bundle.close();
const checkedIn = await readFile(join(pkg, 'dist/index.esm.js'), 'utf8');

// The statements a bundler had to keep: top-level calls that survive in the shaken output.
const keptCalls = code => (code.match(/^(?:await )?[A-Za-z_$][\w$]*\((?:[^()\n]|\([^()\n]*\))*\);?$/gm) ?? []).map(s => s.slice(0, 80));
async function only(runtime, name) {
  const b = await rollup({ input: 'entry', plugins: [{ name: 'helper-entry',
    resolveId: id => ['entry', 'runtime'].includes(id) ? id : null,
    load: id => id === 'entry' ? `export { ${name} } from 'runtime';` : id === 'runtime' ? runtime : null,
  }], onwarn });
  const shaken = (await b.generate({ format: 'esm' })).output[0].code;
  await b.close();
  const min = (await minify(shaken, { module: true })).code;
  return { shaken: size(shaken), minified: size(min), keptTopLevelCalls: keptCalls(shaken), modulesKept: (shaken.match(/^(?:function|class|const|let|var) /gm) ?? []).length };
}
const check = process.argv.includes('--check');
const maxGzip = process.argv.includes('--max-gzip') ? Number(process.argv[process.argv.indexOf('--max-gzip') + 1]) : 1024;
if (check) {
  const r = await only(fresh, 'defineState');
  const ok = r.minified.gzip <= maxGzip;
  console.log(`[state helper entry] defineState-only re-export: ${r.minified.bytes} bytes minified, ${r.minified.gzip} bytes gzip (limit ${maxGzip}); kept evaluation-time calls: ${r.keptTopLevelCalls.length}`);
  if (!ok) { console.error(`[state helper entry] the helper-only import exceeds ${maxGzip} bytes gzip; a module reachable from defineState runs code at evaluation or a value import was added`); process.exit(1); }
  process.exit(0);
}
const results = {};
for (const [label, runtime] of [['before (checked-in dist/index.esm.js, release source)', checkedIn], ['after (src/exports.ts built now: S1 + S2 applied)', fresh]]) {
  results[label] = { full: size(runtime) };
  for (const name of ['defineState', 'VERSION']) results[label][`${name}.only`] = await only(runtime, name);
  console.log(JSON.stringify({ label, full: results[label].full.gzip, defineStateOnly: results[label]['defineState.only'].minified, keptCalls: results[label]['defineState.only'].keptTopLevelCalls.length }));
}
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(),
  method: 'export { <name> } from the bundle → Rollup tree-shake (default options) → terser; sizes in bytes / gzip level 9 / Brotli quality 11',
  note: 'The checked-in dist is built from the release source at HEAD and predates S1 / S2, so the two rows differ only by the uncommitted source changes.',
  results, warnings: [...warnings],
};
await writeFile(join(output, 'helper-import.json'), JSON.stringify(report, null, 2) + '\n');
