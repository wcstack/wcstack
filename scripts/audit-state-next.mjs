// Read-only implementation audit. Build into an OS temporary directory, never dist/.
// Run from the repository root: node scripts/audit-state-next.mjs
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const pkg = join(root, 'packages/state');
const require = createRequire(join(pkg, 'package.json'));
const { rollup } = require('rollup');
const { minify } = require('terser');
const { decode } = require('@jridgewell/sourcemap-codec');
const output = join(root, 'docs/research/state-next');
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'wcstack-state-audit-'));
process.chdir(pkg);
const configs = (await import(pathToFileURL(join(pkg, 'rollup.config.js')))).default;
const warnings = new Set();
const built = {};
for (const config of configs.filter(c => c.input.endsWith('.ts') && !c.output.file.endsWith('.d.ts'))) {
  const bundle = await rollup({ ...config, onwarn: w => warnings.add(`${w.code}: ${w.message}`) });
  const generated = await bundle.generate(config.output);
  const chunk = generated.output.find(o => o.type === 'chunk');
  const name = config.output.file.split('/').at(-1);
  built[name] = chunk;
  await writeFile(join(temp, name), chunk.code);
  await bundle.close();
}
function size(code) {
  const b = Buffer.from(code);
  return { bytes: b.length, gzip: gzipSync(b, { level: 9 }).length,
    brotli: brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
}
const sizes = {};
for (const [name, chunk] of Object.entries(built)) sizes[name] = size(chunk.code);
sizes['index.min.experiment'] = size((await minify(built['index.esm.js'].code, { module: true })).code);
for (const name of ['defineState', 'VERSION']) {
  const bundle = await rollup({ input: 'entry', plugins: [{ name: 'audit-entry',
    resolveId: id => ['entry', 'runtime'].includes(id) ? id : null,
    load: id => id === 'entry' ? `export { ${name} } from 'runtime';` : id === 'runtime' ? built['index.esm.js'].code : null,
  }], onwarn: w => warnings.add(`${w.code}: ${w.message}`) });
  const generated = await bundle.generate({ format: 'esm' });
  sizes[`${name}.only`] = size((await minify(generated.output[0].code, { module: true })).code);
  await bundle.close();
}
const auto = built['auto.min.js'];
const lines = auto.code.split('\n');
const attribution = {};
decode(auto.map.mappings).forEach((segments, line) => {
  segments.forEach((segment, i) => {
    if (segment.length < 4) return;
    const source = auto.map.sources[segment[1]].replaceAll('\\', '/');
    const relative = source.split('/src/').at(-1);
    const group = relative.includes('/') ? relative.split('/')[0] : '(root)';
    const bytes = Buffer.byteLength(lines[line].slice(segment[0], segments[i + 1]?.[0] ?? lines[line].length));
    attribution[group] = (attribution[group] ?? 0) + bytes;
  });
});
const tracked = await readFile(join(pkg, 'dist/auto.min.js'), 'utf8');
const normalize = s => s.replaceAll('\r\n', '\n');
const parser = await import(pathToFileURL(join(temp, 'parser.esm.js')));
const syntax = [];
for (const input of [
  "textContent: x|join(', ')", "textContent: x|join(';')", "textContent: x|join('|')",
  "textContent: x|join('a:b')", "textContent: x|join('unterminated)",
  'value#unknown: x', 'value#ro#wo: x', 'else: ignored', 'radio#ro: x',
  'only: x', 'online: x', 'onclick: x', 'command.run: token', 'eventToken.done: token',
  "textContent: x|join('a,b')", 'textContent: x|join(a,b)',
]) {
  try {
    syntax.push({ input, result: parser.parseBindTextsForElement(input).map(r => ({
      type: r.bindingType, prop: r.propName, modifiers: r.propModifiers, path: r.statePathName,
      filters: r.outFilters.map(f => ({ name: f.filterName, args: f.args,
        sample: f.filterName === 'join' ? f.filterFn(['X', 'Y']) : undefined })),
    })) });
  } catch (e) { syntax.push({ input, error: e.message }); }
}
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(), node: process.version, cpu: cpus()[0].model,
  versions: Object.fromEntries(['rollup', 'terser', 'typescript'].map(n => [n, require(`${n}/package.json`).version])),
  sizes, attribution: Object.fromEntries(Object.entries(attribution).sort((a,b) => b[1]-a[1])),
  autoMatchesCheckedInIgnoringCRLF: normalize(tracked) === normalize(auto.code),
  autoSha256: createHash('sha256').update(normalize(auto.code)).digest('hex'),
  temporaryBuildDirectory: temp, warnings: [...warnings], syntax,
  filterSemantics: [
    ['eq(true)', true], ['eq(1)', 1], ['truthy', 0n], ['boolean', 0n], ['defaults(fallback)', 0],
  ].map(([expression, value]) => ({ expression, input: String(value), inputType: typeof value,
    output: parser.parseBindTextsForElement(`textContent: x|${expression}`)[0].outFilters[0].filterFn(value) })),
};
parser.clearParserCaches();
report.filterCacheIsolated = parser.parseBindTextsForElement('textContent: x|join(a,b)')[0].outFilters[0].filterFn(['X', 'Y']);
await writeFile(join(output, 'size-and-syntax.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, warnings: report.warnings.map(w => w.slice(0, 180)) }, null, 2));
// The imported multi-entry TypeScript configuration can retain worker handles.
process.exit(0);
