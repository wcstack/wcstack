// Runs the AST → IParsedBinding adapter (scripts/research/bindTextAdapterSpike.mjs over the
// lexer spike) against the audit's syntax cases and the data-wcs corpus, compares its output
// with the shipped parser including the behaviour of the built filter functions, and measures
// the grammar stage's size like for like: the shipped bindTextParser/ modules bundled alone
// (everything outside that directory external) against spike + adapter bundled alone (path
// info and filter functions injected). Temporary builds; dist untouched. Run from the
// repository root after `npm ci` in packages/state/:
//   node scripts/audit-state-tech-adapter.mjs
import { readFile, writeFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, sep, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { createAdapter } from './research/bindTextAdapterSpike.mjs';

const root = resolve(import.meta.dirname, '..');
const pkg = join(root, 'packages/state');
const src = join(pkg, 'src');
const require = createRequire(join(pkg, 'package.json'));
const { rollup } = require('rollup');
const { minify } = require('terser');
const typescript = require('@rollup/plugin-typescript');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'wcstack-state-adapter-'));
const size = code => { const b = Buffer.from(code); return { bytes: b.length, gzip: gzipSync(b, { level: 9 }).length,
  brotli: brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length }; };
process.chdir(pkg);
const tsPlugin = () => typescript({ tsconfig: join(pkg, 'tsconfig.json'), declaration: false, declarationMap: false, sourceMap: false, inlineSources: false });

// --- the shipped filter functions, bundled for use here -----------------------------------
async function bundleTo(name, input, plugins, external) {
  const bundle = await rollup({ input, plugins, external, onwarn: () => {} });
  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();
  const code = output.find(o => o.type === 'chunk').code;
  const file = join(temp, name);
  await writeFile(file, code);
  return { file, code };
}
const filtersBuild = await bundleTo('filters.js', join(src, 'filters/builtinFilters.ts'), [tsPlugin()]);
const filters = await import(pathToFileURL(filtersBuild.file));
const current = await import(pathToFileURL(join(pkg, 'dist/parser.esm.js')));
const manifest = JSON.parse(await readFile(join(pkg, 'dist/wcs-manifest.json'), 'utf8'));
const adapter = createAdapter({ getPathInfo: current.getPathInfo, builtinFilterFn: filters.builtinFilterFn, filtersByIOType: filters.builtinFiltersByFilterIOType,
  options: { flags: manifest.syntax.modifiers.flags, keyValue: manifest.syntax.modifiers.keyValue, filterMeta: manifest.filterMeta } });

// --- like-for-like size of the grammar stage ------------------------------------------------
// Shipped: src/bindTextParser/* bundled alone; imports that leave the directory stay external.
const parserDir = join(src, 'bindTextParser');
const keepInside = { name: 'external-outside-bindTextParser', resolveId(source, importer) {
  if (!importer || !source.startsWith('.')) return null;
  const target = resolve(dirname(importer), source);
  return target.startsWith(parserDir) ? null : { id: source, external: true };
} };
const shipped = await bundleTo('shipped-grammar.js', join(parserDir, 'parseBindTextsForElement.ts'), [keepInside, tsPlugin()]);
const shippedMin = (await minify(shipped.code, { module: true })).code;
// Spike + adapter bundled alone (plain JavaScript, nothing external).
const spikeAdapter = await bundleTo('spike-adapter.js', join(root, 'scripts/research/bindTextAdapterSpike.mjs'), []);
const spikeAdapterMin = (await minify(spikeAdapter.code, { module: true })).code;
const spikeOnly = await bundleTo('spike-only.js', join(root, 'scripts/research/bindTextLexerSpike.mjs'), []);
const spikeOnlyMin = (await minify(spikeOnly.code, { module: true })).code;

// --- comparison with the shipped parser (shape + filter behaviour) ---------------------------
const PROBES = [['X', 'Y'], 'abc', 3, 0, true, null, undefined, 1234.567];
const probe = fn => PROBES.map(v => { try { const r = fn(v); return typeof r === 'function' ? '[fn]' : JSON.stringify(r) ?? String(r); } catch (e) { return `throws:${e.constructor.name}`; } });
const project = list => list.map(r => ({
  type: r.bindingType, prop: r.propName, segments: r.propSegments, mods: r.propModifiers, path: r.statePathName,
  pathInfo: r.statePathInfo?.path, in: r.inFilters.map(f => [f.filterName, f.args, probe(f.filterFn)]), out: r.outFilters.map(f => [f.filterName, f.args, probe(f.filterFn)]),
}));
function compare(text) {
  let a, c;
  try { a = { ok: true, value: project(adapter.parseBindTextsForElement(text)) }; } catch (e) { a = { ok: false, error: e.message.split('\n')[0].slice(0, 160) }; }
  try { c = { ok: true, value: project(current.parseBindTextsForElement(text)) }; } catch (e) { c = { ok: false, error: e.message.split('\n')[0].slice(0, 160) }; }
  let verdict;
  if (!a.ok && !c.ok) verdict = 'both-reject';
  else if (!a.ok) verdict = 'adapter-rejects-only';
  else if (!c.ok) verdict = 'current-rejects-only';
  else if (JSON.stringify(a.value) === JSON.stringify(c.value)) verdict = 'same';
  else {
    const strip = v => v.map(b => ({ ...b, in: b.in.map(f => f.slice(0, 2)), out: b.out.map(f => f.slice(0, 2)) }));
    verdict = JSON.stringify(strip(a.value)) === JSON.stringify(strip(c.value)) ? 'filter-behaviour-differs' : 'shape-differs';
  }
  return { text, verdict, adapter: a.ok ? a.value : { error: a.error }, current: c.ok ? c.value : { error: c.error } };
}
const cases = [
  "textContent: x|join(', ')", "textContent: x|join(';')", "textContent: x|join('|')", "textContent: x|join('a:b')",
  "textContent: x|join('unterminated)", 'value#unknown: x', 'value#ro#wo: x', 'else: ignored', 'radio#ro: x',
  'only: x', 'online: x', 'onclick: x', 'command.run: token', 'eventToken.done: token', "textContent: x|join('a,b')", 'textContent: x|join(a,b)',
  'else:', 'for#x: items', 'if: a; textContent: b', "textContent: x|join('it\\'s')", 'attr.data-id: x', 'onclick#prevent,stop: run',
  'value#init=element,sync=connect: w', 'value#init: w', '...: obj', '...: obj|int', 'command.run: $command.go', 'eventToken.error#prevent: createFailed',
  "textContent: x|pad(5, ' ')", 'textContent: x|eq(1,2)', 'textContent: x|nope', 'textContent: x|join(', 'textContent: x|join)', "textContent: x|join('a') extra",
  'textContent: user@main.name', 'class.active: .selected', 'textContent: items.*.name', 'textContent: $1', 'textContent: ..parent', 'textContent:', 'textContent',
  'textContent: x|fix(2)|locale', 'value|int: count', 'checkbox|int: values', 'textContent: x|join(a,)', 'textContent: x|eq()', 'textContent: x|rep(3)|uc',
  'textContent: price|fix(2)|unit(円)', "textContent: name|defaults('n/a')|cap", 'style.width: ratio|mul(100)|unit(%)', 'attr.title: items|join(" / ")',
];
async function walk(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.tsc-out', '.git', 'coverage'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out); else out.push(full);
  }
  return out;
}
const all = [...await walk(join(root, 'examples'), []), ...await walk(join(root, 'packages'), [])];
const rel = f => relative(root, f).split(sep).join('/');
const corpusFiles = all.filter(f => { const r = rel(f);
  if (r.endsWith('.html')) return r.includes('/examples/') || r.includes('/__e2e__/');
  return /^packages\/[^/]+\/README(\.ja)?\.md$/.test(r) && basename(f).startsWith('README'); });
const corpus = new Map();
for (const file of corpusFiles) {
  const text = await readFile(file, 'utf8');
  for (const m of text.matchAll(/data-wcs\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = (m[1] ?? m[2]).trim();
    if (value === '' || value.includes('{{')) continue;
    (corpus.get(value) ?? corpus.set(value, { files: new Set() }).get(value)).files.add(rel(file));
  }
}
const corpusResults = [...corpus.entries()].map(([text, { files }]) => ({ ...compare(text), files: [...files].slice(0, 2) }));
const verdicts = {};
for (const r of corpusResults) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), timestamp: new Date().toISOString(),
  temporaryBuildDirectory: temp,
  sizes: {
    shippedGrammarStage: { note: 'src/bindTextParser/* bundled alone; imports outside the directory external', unminified: size(shipped.code), minified: size(shippedMin) },
    spikeOnly: { note: 'bindTextLexerSpike.mjs alone', unminified: size(spikeOnly.code), minified: size(spikeOnlyMin) },
    spikePlusAdapter: { note: 'bindTextLexerSpike.mjs + bindTextAdapterSpike.mjs; path info and filter functions injected', unminified: size(spikeAdapter.code), minified: size(spikeAdapterMin) },
    adapterLines: (await readFile(join(root, 'scripts/research/bindTextAdapterSpike.mjs'), 'utf8')).split('\n').length,
  },
  probes: PROBES.map(p => Array.isArray(p) ? p : String(p)),
  cases: cases.map(compare),
  corpus: { files: corpusFiles.length, unique: corpus.size, verdicts, notSame: corpusResults.filter(r => r.verdict !== 'same').sort((a, b) => a.verdict.localeCompare(b.verdict)) },
};
await writeFile(join(outDir, 'adapter-spike.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sizes: report.sizes, corpus: { files: corpusFiles.length, unique: corpus.size, verdicts } }, null, 2));
for (const c of report.cases) if (c.verdict !== 'same') console.log(`${c.verdict.padEnd(24)} ${JSON.stringify(c.text)}`);
for (const r of report.corpus.notSame) if (!['both-reject'].includes(r.verdict)) console.log(`corpus ${r.verdict.padEnd(24)} ${JSON.stringify(r.text)} ${r.files[0]}`);
process.exit(0);
