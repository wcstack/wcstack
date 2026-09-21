// Member-level size attribution and feature references for the largest core files. Builds
// the named entry with source maps into an OS temporary directory, minifies it with terser
// while composing the maps, attributes minified bytes to original (file, line), and rolls the
// lines up to the enclosing top-level declaration or class member found with the TypeScript
// AST. For each member it also lists which src directories its identifiers reach through the
// file's imports, so responsibilities (declaration processing / lifecycle / DOM / feature
// wiring) can be read off. Read-only; dist untouched. Run from the repository root:
//   node scripts/audit-state-tech-members.mjs [src-relative files...]
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const pkg = join(root, 'packages/state');
const src = join(pkg, 'src');
const require = createRequire(join(pkg, 'package.json'));
const { rollup } = require('rollup');
const { minify } = require('terser');
const ts = require('typescript');
const { decode } = require('@jridgewell/sourcemap-codec');
const outDir = join(root, 'docs/research/state-next');
await mkdir(outDir, { recursive: true });
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const files = args.length ? args : ['components/State.ts', 'bindings/BindingSession.ts', 'proxy/methods/setByAddress.ts', 'apply/applyChangeToFor.ts', 'event/twowayHandler.ts'];
const FEATURE_GROUPS = ['watch', 'stream', 'scan', 'webComponent', 'dcc', 'devtools', 'recursion', 'stateLoader', 'protocol', 'contract', 'command', 'token', 'hydrater'];

// --- build the full named entry with composed source maps ----------------------------------
const temp = await mkdtemp(join(tmpdir(), 'wcstack-state-members-'));
process.chdir(pkg);
const configs = (await import(pathToFileURL(join(pkg, 'rollup.config.js')))).default;
const config = configs.find(c => c.output.file.endsWith('index.esm.js'));
const bundle = await rollup({ ...config, onwarn: () => {} });
const generated = await bundle.generate({ format: 'esm', sourcemap: true });
await bundle.close();
const chunk = generated.output.find(o => o.type === 'chunk');
const min = await minify(chunk.code, { module: true, sourceMap: { content: JSON.parse(chunk.map.toString()), includeSources: false } });
await writeFile(join(temp, 'index.min.js'), min.code);
const map = JSON.parse(min.map);
const outLines = min.code.split('\n');
const perLine = new Map(); // source (src-relative) -> Map(original 0-based line -> minified bytes)
decode(map.mappings).forEach((segments, line) => segments.forEach((segment, i) => {
  if (segment.length < 4) return;
  const source = map.sources[segment[1]].replaceAll('\\', '/');
  const rel = source.includes('/src/') ? source.split('/src/').at(-1) : source;
  const len = Buffer.byteLength(outLines[line].slice(segment[0], segments[i + 1]?.[0] ?? outLines[line].length));
  let m = perLine.get(rel);
  if (!m) perLine.set(rel, m = new Map());
  m.set(segment[2], (m.get(segment[2]) ?? 0) + len);
}));
const totalMinified = Buffer.byteLength(min.code);

// --- per file: members from the AST, bytes per member, imported groups referenced ----------
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  timestamp: new Date().toISOString(), totalMinifiedBytes: totalMinified, temporaryBuildDirectory: temp,
  note: 'Bytes are minified bytes attributed through the composed source map, rolled up to the enclosing top-level declaration or class member. refs lists imported value identifiers used inside the member, grouped by the source directory they come from (interface-looking names I* are ignored).',
  files: {},
};
for (const file of files) {
  const abs = join(src, file);
  const text = await readFile(abs, 'utf8');
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.ESNext, true);
  const groupOf = spec => {
    const rel = relative(src, resolve(dirname(abs), spec.replace(/\.js$/, ''))).split(sep).join('/');
    return rel.includes('/') ? rel.split('/')[0] : '(root)';
  };
  const importedNames = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.moduleSpecifier.text.startsWith('.')) continue;
    const clause = st.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const group = groupOf(st.moduleSpecifier.text);
    if (clause.name) importedNames.set(clause.name.text, group);
    const nb = clause.namedBindings;
    if (!nb) continue;
    if (ts.isNamespaceImport(nb)) importedNames.set(nb.name.text, group);
    else for (const e of nb.elements) if (!e.isTypeOnly) importedNames.set(e.name.text, group);
  }
  const lineOf = pos => sf.getLineAndCharacterOfPosition(pos).line;
  const members = [];
  const add = (node, name, kind) => members.push({ name, kind, start: lineOf(node.getStart(sf)), end: lineOf(node.getEnd()), node });
  for (const st of sf.statements) {
    if (ts.isClassDeclaration(st)) {
      const cls = st.name?.text ?? '(class)';
      for (const m of st.members) {
        const name = ts.isConstructorDeclaration(m) ? 'constructor' : m.name ? m.name.getText(sf) : '(member)';
        const kind = ts.isMethodDeclaration(m) ? 'method' : ts.isGetAccessor(m) ? 'get' : ts.isSetAccessor(m) ? 'set'
          : ts.isPropertyDeclaration(m) ? 'property' : ts.isConstructorDeclaration(m) ? 'constructor' : 'member';
        add(m, `${cls}.${name}`, kind);
      }
    } else if (ts.isFunctionDeclaration(st)) add(st, st.name?.text ?? '(function)', 'function');
    else if (ts.isVariableStatement(st)) add(st, st.declarationList.declarations.map(d => d.name.getText(sf)).join(','), 'variable');
    else if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) continue;
    else add(st, st.getText(sf).slice(0, 40).replace(/\s+/g, ' '), 'statement');
  }
  // innermost member for a line: smallest range containing it
  const memberAt = line => {
    let best = null;
    for (const m of members) if (m.start <= line && line <= m.end && (!best || (m.end - m.start) < (best.end - best.start))) best = m;
    return best;
  };
  const bytesByMember = new Map();
  let fileBytes = 0;
  for (const [line, bytes] of perLine.get(file) ?? []) {
    fileBytes += bytes;
    const m = memberAt(line);
    const key = m ? m.name : '(module level)';
    bytesByMember.set(key, (bytesByMember.get(key) ?? 0) + bytes);
  }
  const refsOf = node => {
    const found = new Map();
    const visit = n => {
      if (ts.isIdentifier(n) && importedNames.has(n.text) && !/^I[A-Z]/.test(n.text)) {
        const g = importedNames.get(n.text);
        if (!found.has(g)) found.set(g, new Set());
        found.get(g).add(n.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return Object.fromEntries([...found].sort((a, b) => a[0].localeCompare(b[0])).map(([g, s]) => [g, [...s].sort()]));
  };
  const rows = members.map(m => ({ name: m.name, kind: m.kind, lines: [m.start + 1, m.end + 1], loc: m.end - m.start + 1,
    bytes: bytesByMember.get(m.name) ?? 0, refs: refsOf(m.node) }));
  if (bytesByMember.has('(module level)')) rows.push({ name: '(module level)', kind: 'module', lines: null, loc: null, bytes: bytesByMember.get('(module level)'), refs: {} });
  rows.sort((a, b) => b.bytes - a.bytes);
  const featureBytes = rows.filter(r => Object.keys(r.refs).some(g => FEATURE_GROUPS.includes(g))).reduce((a, r) => a + r.bytes, 0);
  const byReferencedGroup = {};
  for (const r of rows) for (const g of Object.keys(r.refs)) byReferencedGroup[g] = (byReferencedGroup[g] ?? 0) + r.bytes;
  report.files[file] = { bytes: fileBytes, members: rows.length, membersReferencingFeatures: { bytes: featureBytes, share: Math.round(featureBytes / fileBytes * 1000) / 10 },
    bytesOfMembersByReferencedGroup: Object.fromEntries(Object.entries(byReferencedGroup).sort((a, b) => b[1] - a[1])), rows };
  console.log(`\n== ${file}: ${fileBytes} minified bytes in ${rows.length} members; members touching feature groups: ${featureBytes} (${report.files[file].membersReferencingFeatures.share}%)`);
  for (const r of rows.slice(0, 25)) console.log(String(r.bytes).padStart(6), r.kind.padEnd(11), r.name.padEnd(48), Object.keys(r.refs).join(','));
}
await writeFile(join(outDir, 'member-attribution.json'), JSON.stringify(report, null, 2) + '\n');
process.exit(0);
