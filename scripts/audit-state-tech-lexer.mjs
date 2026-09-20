// Runs the quote-aware lexer spike (scripts/research/bindTextLexerSpike.mjs) against the
// audit's syntax cases and every data-wcs attribute in the examples, e2e fixtures and package
// READMEs, compares its AST with the shipped parser (packages/state/dist/parser.esm.js), and
// measures the spike's minified size. Read-only. Run from the repository root:
//   node scripts/audit-state-tech-lexer.mjs
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join, relative, sep, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { parseBindText } from './research/bindTextLexerSpike.mjs';

const root = resolve(import.meta.dirname, '..');
const pkg = join(root, 'packages/state');
const require = createRequire(join(pkg, 'package.json'));
const { minify } = require('terser');
const output = join(root, 'docs/research/state-next');
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(join(pkg, 'dist/wcs-manifest.json'), 'utf8'));
const options = { flags: manifest.syntax.modifiers.flags, keyValue: manifest.syntax.modifiers.keyValue, filterMeta: manifest.filterMeta };
const current = await import(pathToFileURL(join(pkg, 'dist/parser.esm.js')));

const cases = [
  // the audit's reproduction set (docs/state-next-major-audit.md §5.1)
  "textContent: x|join(', ')", "textContent: x|join(';')", "textContent: x|join('|')", "textContent: x|join('a:b')",
  "textContent: x|join('unterminated)", 'value#unknown: x', 'value#ro#wo: x', 'else: ignored', 'radio#ro: x',
  'only: x', 'online: x', 'onclick: x', 'command.run: token', 'eventToken.done: token', "textContent: x|join('a,b')", 'textContent: x|join(a,b)',
  // more edge cases for the diagnostics
  'else:', 'for#x: items', 'if: a; textContent: b', "textContent: x|join('it\\'s')", 'attr.data-id: x', 'onclick#prevent,stop: run',
  'value#init=element,sync=connect: w', 'value#init: w', '...: obj', '...: obj|int', 'command.run: $command.go', 'eventToken.error#prevent: createFailed',
  "textContent: x|pad(5, ' ')", 'textContent: x|eq(1,2)', 'textContent: x|nope', 'textContent: x|join(', 'textContent: x|join)', "textContent: x|join('a') extra",
  'textContent: user@main.name', 'class.active: .selected', 'textContent: items.*.name', 'textContent: $1', 'textContent: ..parent', 'textContent:', 'textContent',
  'textContent: x|fix(2)|locale', 'value|int: count', 'checkbox|int: values', 'textContent: x|join(a,)', 'textContent: x|eq()', "textContent: x|rep('a', 'b')|uc",
];
const projectSpike = ast => ast.bindings.map(b => ({
  type: b.kind, prop: b.prop.name, mods: b.prop.modifiers.map(m => m.value === undefined ? m.name : `${m.name}=${m.value}`),
  path: b.kind === 'else' ? '#else' : b.path.text,
  in: b.inFilters.map(f => [f.name, f.args.map(a => a.value)]), out: b.outFilters.map(f => [f.name, f.args.map(a => a.value)]),
}));
const projectCurrent = list => list.map(r => ({
  type: r.bindingType, prop: r.propName, mods: r.propModifiers, path: r.statePathName,
  in: r.inFilters.map(f => [f.filterName, f.args]), out: r.outFilters.map(f => [f.filterName, f.args]),
}));
function compare(text) {
  const spike = parseBindText(text, options);
  let cur;
  try { cur = { ok: true, value: projectCurrent(current.parseBindTextsForElement(text)) }; }
  catch (e) { cur = { ok: false, error: e.message.split('\n')[0].slice(0, 200) }; }
  const errors = spike.diagnostics.filter(d => d.code.startsWith('E_'));
  const projected = projectSpike(spike);
  let verdict;
  if (!cur.ok && errors.length) verdict = 'both-reject';
  else if (!cur.ok) verdict = 'current-rejects-only';
  else if (errors.length) verdict = 'spike-rejects-only';
  else verdict = JSON.stringify(cur.value) === JSON.stringify(projected) ? 'same' : 'shape-differs';
  return { text, verdict, spike: projected, diagnostics: spike.diagnostics, current: cur.ok ? cur.value : { error: cur.error } };
}
// Corpus: every data-wcs attribute value in examples, e2e fixtures and package READMEs.
async function walk(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.tsc-out', '.git', 'coverage'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}
const all = [...await walk(join(root, 'examples'), []), ...await walk(join(root, 'packages'), [])];
const rel = f => relative(root, f).split(sep).join('/');
const corpusFiles = all.filter(f => {
  const r = rel(f);
  if (r.endsWith('.html')) return r.includes('/examples/') || r.includes('/__e2e__/');
  return /^packages\/[^/]+\/README(\.ja)?\.md$/.test(r) && basename(f).startsWith('README');
});
const corpus = new Map();
for (const file of corpusFiles) {
  const text = await readFile(file, 'utf8');
  for (const m of text.matchAll(/data-wcs\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = (m[1] ?? m[2]).trim();
    if (value === '' || value.includes('{{')) continue;
    const entry = corpus.get(value) ?? { files: new Set() };
    entry.files.add(rel(file));
    corpus.set(value, entry);
  }
}
const corpusResults = [...corpus.entries()].map(([text, { files }]) => ({ ...compare(text), files: [...files].slice(0, 3), fileCount: files.size }));
const verdicts = {};
for (const r of corpusResults) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
// Size of the spike alone (no PathInfo, no filter functions), for the grammar-stage budget.
const spikeSource = await readFile(join(root, 'scripts/research/bindTextLexerSpike.mjs'), 'utf8');
const minified = (await minify(spikeSource, { module: true })).code;
const size = code => { const b = Buffer.from(code); return { bytes: b.length, gzip: gzipSync(b, { level: 9 }).length,
  brotli: brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length }; };
let currentParserSize = null;
try { currentParserSize = JSON.parse(await readFile(join(output, 'size-and-syntax.json'), 'utf8')).sizes['parser.esm.js']; } catch {}
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(),
  spike: { lines: spikeSource.split('\n').length, source: size(spikeSource), minified: size(minified) },
  currentParserEntry: currentParserSize,
  cacheKey: {
    current: { "join('a,b')": `join(${['a,b'].join(',')})`, 'join(a,b)': `join(${['a', 'b'].join(',')})` },
    structural: { "join('a,b')": JSON.stringify(['join', ['a,b']]), 'join(a,b)': JSON.stringify(['join', ['a', 'b']]) },
  },
  cases: cases.map(compare),
  corpus: { files: corpusFiles.length, unique: corpus.size, verdicts,
    notSame: corpusResults.filter(r => r.verdict !== 'same').sort((a, b) => a.verdict.localeCompare(b.verdict)) },
};
await writeFile(join(output, 'lexer-spike.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ spike: report.spike, currentParserEntry: currentParserSize, corpus: { files: corpusFiles.length, unique: corpus.size, verdicts } }, null, 2));
for (const c of report.cases) console.log(`${c.verdict.padEnd(22)} ${JSON.stringify(c.text)} ${c.diagnostics.map(d => d.code).join(',')}`);
for (const r of report.corpus.notSame) console.log(`corpus ${r.verdict.padEnd(22)} ${JSON.stringify(r.text)} ${r.diagnostics.map(d => d.code).join(',')} ${r.files[0]}`);
