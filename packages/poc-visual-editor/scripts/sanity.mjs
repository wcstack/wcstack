// Quick parser sanity check. Not a real test suite — just exercises
// the parser against the bundled examples and prints the resulting
// graph so we can eyeball that wildcard / mustache / structural
// detection is working.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Window } from '../../state/node_modules/happy-dom/lib/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Make happy-dom globals available for parser and renderer.
const win = new Window();
globalThis.DOMParser = win.DOMParser;
globalThis.Node = win.Node;
globalThis.document = win.document;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const { parseHtml } = await import(pathToFileURL(resolve(root, 'src/parser.js')).href);
const { renderGraph } = await import(pathToFileURL(resolve(root, 'src/render.js')).href);

const samples = [
  'examples/counter.html',
  'examples/list.html',
  'examples/form.html',
  'examples/nested.html',
];

for (const rel of samples) {
  const html = readFileSync(resolve(root, rel), 'utf8');
  const graph = parseHtml(html);
  console.log('========== ' + rel + ' ==========');
  for (const s of graph.states) {
    console.log(`  state[${s.name}]:`);
    for (const p of s.paths) console.log(`    - ${p}`);
  }
  // Build a tree by parentId so the dump shows nesting.
  const childrenOf = new Map();
  for (const c of graph.components) {
    if (c.parentId) {
      if (!childrenOf.has(c.parentId)) childrenOf.set(c.parentId, []);
      childrenOf.get(c.parentId).push(c);
    }
  }
  function dumpComp(c, depth) {
    const indent = '  ' + '    '.repeat(depth);
    const tag = c.structural ? `<${c.tag}> ${c.structuralKind}` : `<${c.tag}>`;
    const scope = c.scope ? ` (scope=${c.scope})` : '';
    console.log(`${indent}${tag}${scope}`);
    for (const p of c.ports) {
      const lbl = p.label || p.property;
      const tags = [];
      if (p.kind !== 'in') tags.push(p.kind);
      if (p.mustache) tags.push('mustache');
      if (p.wildcard) tags.push('wildcard');
      console.log(`${indent}  · ${lbl}${tags.length ? ' [' + tags.join(',') + ']' : ''}`);
    }
    for (const ch of (childrenOf.get(c.id) || [])) dumpComp(ch, depth + 1);
  }
  for (const c of graph.components.filter(c => !c.parentId)) dumpComp(c, 0);
  for (const w of graph.wires) {
    const compId = w.to.componentId.split(':').slice(1).join(':');
    const filters = w.filters.length ? ' |' + w.filters.join('|') : '';
    const wc = w.wildcard ? ' (wildcard)' : '';
    let src = '';
    if (w.sourceRange) {
      const r = w.sourceRange;
      src = `  src=[${r.attrStart}..${r.attrEnd}) value=[${r.valueStart}..${r.valueEnd}) piece=${r.pieceIdx}`;
    }
    console.log(`  wire: ${w.from.path}  --[${w.direction}${filters}${wc}]-->  ${compId}/${w.to.property}${src}`);
  }

  // Smoke-test the renderer: no runtime error and produces a viewBox.
  const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    const vb = renderGraph(graph, svg);
    const tops = graph.components.filter(c => !c.parentId);
    const nested = graph.components.length - tops.length;
    console.log(`  layout: viewBox=${vb.w.toFixed(0)}x${vb.h.toFixed(0)}  top=${tops.length}  nested=${nested}`);
  } catch (e) {
    console.log(`  RENDER ERROR: ${e.message}`);
  }
  console.log('');
}
