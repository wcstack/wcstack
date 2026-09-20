// Size of the named entry when optional feature groups are replaced by stubs at build time:
// an upper bound for what a core-only chunk would weigh under the current source, before any
// restructuring. Feature call sites stay in the core and only the feature bodies are gone, so
// the stubbed bundles are not runnable; they are measured, never executed. Each variant is
// also attributed per source module through the source map of the minified output, so the
// remainder can be read module by module. Temporary build, dist untouched. Run from the
// repository root after `npm ci` in packages/state/:
//   node scripts/audit-state-tech-split.mjs
import { writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const pkg = join(root, 'packages/state');
const require = createRequire(join(pkg, 'package.json'));
const { rollup } = require('rollup');
const { minify } = require('terser');
const ts = require('typescript');
const { decode } = require('@jridgewell/sourcemap-codec');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });

// Cumulative groups, in the order the audit (§6) suggested measuring: devtools, temporal
// (watch/scan/streams), recursion, component scopes (mount/volume/overlay/DCC), SSR, formats.
const GROUPS = {
  devtools: id => id.startsWith('devtools/'),
  temporal: id => /^(watch|scan|stream)\//.test(id),
  recursion: id => id.startsWith('recursion/'),
  scopes: id => /^(webComponent|dcc)\//.test(id),
  ssr: id => id === 'components/Ssr.ts' || id === 'buildSsrDocument.ts' || id === 'hydrateBindings.ts' || id.startsWith('hydrater/'),
  formats: id => id.startsWith('filters/'),
};
const VARIANTS = [[], ['devtools'], ['devtools', 'temporal'], ['devtools', 'temporal', 'recursion'],
  ['devtools', 'temporal', 'recursion', 'scopes'], ['devtools', 'temporal', 'recursion', 'scopes', 'ssr'],
  ['devtools', 'temporal', 'recursion', 'scopes', 'ssr', 'formats']];

// Collect the names a transformed (JavaScript) module exports, so the stub keeps the same
// export surface and the core still links.
function stubFor(code, id) {
  const sf = ts.createSourceFile(id, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const names = new Set();
  const passthrough = [];
  let hasDefault = false;
  const isExported = n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) names.add(e.name.text);
      else passthrough.push(st.getText(sf)); // export * from './x' — the target is stubbed on its own if it is in the group
    } else if (ts.isExportAssignment(st)) hasDefault = true;
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && isExported(st)) {
      if (st.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) hasDefault = true;
      else if (st.name) names.add(st.name.text);
    } else if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    }
  }
  return [...names].map(n => `export const ${n} = undefined;`).join('\n') + (hasDefault ? '\nexport default undefined;' : '') + '\n' + passthrough.join('\n') + '\n';
}
const size = code => { const b = Buffer.from(code); return { bytes: b.length, gzip: gzipSync(b, { level: 9 }).length,
  brotli: brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length }; };
// Minified bytes attributed to each source module through the source map (same method as
// audit-state-next.mjs). Bytes, not gzip: an estimate of where the remainder lives.
function attribute(code, map) {
  const lines = code.split('\n');
  const bytes = {};
  decode(map.mappings).forEach((segments, line) => segments.forEach((segment, i) => {
    if (segment.length < 4) return;
    const source = map.sources[segment[1]].replaceAll('\\', '/');
    const rel = source.includes('/src/') ? source.split('/src/').at(-1) : source;
    const len = Buffer.byteLength(lines[line].slice(segment[0], segments[i + 1]?.[0] ?? lines[line].length));
    bytes[rel] = (bytes[rel] ?? 0) + len;
  }));
  return Object.fromEntries(Object.entries(bytes).sort((a, b) => b[1] - a[1]));
}
const groupOf = m => m.includes('/') ? m.split('/')[0] : '(root)';
const temp = await mkdtemp(join(tmpdir(), 'wcstack-state-split-'));
process.chdir(pkg);
const configs = (await import(pathToFileURL(join(pkg, 'rollup.config.js')))).default;
const config = configs.find(c => c.output.file.endsWith('index.esm.js'));
const results = [];
for (const groups of VARIANTS) {
  const predicates = groups.map(g => GROUPS[g]);
  const stubbed = new Set();
  const plugin = {
    name: 'wcs-stub',
    transform(code, id) {
      const rel = id.replaceAll('\\', '/').split('/src/')[1];
      if (!rel || !predicates.some(p => p(rel))) return null;
      stubbed.add(rel);
      return { code: stubFor(code, id), map: null };
    },
  };
  const warnings = new Set();
  const bundle = await rollup({ ...config, plugins: [...config.plugins, plugin], onwarn: w => warnings.add(w.code) });
  const generated = await bundle.generate({ format: 'esm', sourcemap: true });
  await bundle.close();
  const chunk = generated.output.find(o => o.type === 'chunk');
  const min = await minify(chunk.code, { module: true, sourceMap: { content: JSON.parse(chunk.map.toString()), includeSources: false } });
  const label = groups.length ? `-${groups.join('-')}` : 'full';
  await writeFile(join(temp, `index${label}.min.js`), min.code);
  const byModule = attribute(min.code, JSON.parse(min.map));
  const byGroup = {};
  for (const [m, b] of Object.entries(byModule)) byGroup[groupOf(m)] = (byGroup[groupOf(m)] ?? 0) + b;
  const last = groups.length === VARIANTS.at(-1).length;
  const r = { variant: label, stubbedGroups: groups, stubbedModules: stubbed.size, unminified: size(chunk.code), minified: size(min.code),
    byGroup: Object.fromEntries(Object.entries(byGroup).sort((a, b) => b[1] - a[1])), ...(groups.length === 0 || last ? { byModule } : {}), warnings: [...warnings] };
  results.push(r);
  console.log(JSON.stringify({ variant: r.variant, stubbedModules: r.stubbedModules, minified: r.minified }));
}
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(), temporaryBuildDirectory: temp,
  note: 'Stubbed bundles keep every core call site into the feature and are not runnable; sizes are an upper bound for a core chunk under the current source. byGroup/byModule are minified bytes attributed through the source map, not gzip.',
  results,
};
await writeFile(join(outDir, 'split-stub-sizes.json'), JSON.stringify(report, null, 2) + '\n');
const final = results.at(-1);
console.log('remainder by group:', JSON.stringify(final.byGroup));
for (const [m, b] of Object.entries(final.byModule).slice(0, 30)) console.log(String(b).padStart(7), m);
process.exit(0);
