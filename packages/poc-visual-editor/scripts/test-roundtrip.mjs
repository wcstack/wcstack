// Round-trip test: parse HTML → pick a wire → splice it out of the
// source → re-parse → confirm the wire is gone and the rest of the
// graph is preserved. Uses the same deleteBindingFromSource logic
// that index.html has inlined.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Window } from '../../state/node_modules/happy-dom/lib/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const win = new Window();
globalThis.DOMParser = win.DOMParser;
globalThis.Node = win.Node;
globalThis.document = win.document;

const { parseHtml, splitTopLevelWithPos } = await import(pathToFileURL(resolve(root, 'src/parser.js')).href);

function deleteBindingFromSource(source, range) {
  const value = source.slice(range.valueStart, range.valueEnd);
  const allPieces = splitTopLevelWithPos(value, ';');
  if (allPieces.filter(p => p.text.trim()).length <= 1) {
    return source.slice(0, range.attrStart) + source.slice(range.attrEnd);
  }
  const target = allPieces[range.pieceIdx];
  const isLast = range.pieceIdx === allPieces.length - 1;
  let from, to;
  if (isLast) {
    from = allPieces[range.pieceIdx - 1].end;
    to = target.end;
  } else {
    from = target.start;
    to = allPieces[range.pieceIdx + 1].start;
    while (to < value.length && /\s/.test(value[to])) to++;
  }
  const newValue = value.slice(0, from) + value.slice(to);
  return source.slice(0, range.valueStart) + newValue + source.slice(range.valueEnd);
}

const cases = [
  {
    name: 'counter.html: delete first piece (class.plus) from a 2-piece data-wcs',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.to.property === 'class.plus' && w.sourceRange),
    expectGone: w => w.to.property === 'class.plus',
    expectKept: ['class.minus', 'onclick'],
  },
  {
    name: 'counter.html: delete last piece (class.minus) from a 2-piece data-wcs',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.to.property === 'class.minus' && w.sourceRange),
    expectGone: w => w.to.property === 'class.minus',
    expectKept: ['class.plus', 'onclick'],
  },
  {
    name: 'counter.html: delete only-binding attribute (onclick: increment)',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.from.path === 'increment' && w.sourceRange),
    expectGone: w => w.from.path === 'increment',
    expectKept: ['decrement', 'class.plus', 'class.minus'],
    expectAttrRemoved: 'onclick: increment',
  },
  {
    name: 'list.html: delete structural for binding (whole attr)',
    file: 'examples/list.html',
    pickWire: (g) => g.wires.find(w => w.to.property === 'for' && w.sourceRange),
    expectGone: w => w.to.property === 'for' && w.from.path === 'users',
    expectKept: [],
    expectAttrRemoved: 'for: users',
  },
];

// Additional invalidation test: deleting `for: users` should cause the
// inner mustache wires (which used `.name`, etc.) to become invalid
// because their relative paths no longer have a scope.
const invalidationCases = [
  {
    name: 'list.html: deleting for: users invalidates inner mustache wires',
    file: 'examples/list.html',
    pickWire: (g) => g.wires.find(w => w.to.property === 'for' && w.from.path === 'users'),
    expectInvalidPaths: ['.name', '.age', '.ageCategory'],
  },
];

function editFilterInSource(source, filterRange, nextRaw) {
  let next = (nextRaw || '').trim();
  if (next && !next.startsWith('|')) next = '|' + next;
  return source.slice(0, filterRange.start) + next + source.slice(filterRange.end);
}

function rewirePathInSource(source, pathRange, newPath) {
  return source.slice(0, pathRange.start) + newPath + source.slice(pathRange.end);
}

function appendBindingToValue(source, sampleSourceRange, property, path) {
  const valueEnd = sampleSourceRange.valueEnd;
  const value = source.slice(sampleSourceRange.valueStart, valueEnd);
  const trimmed = value.replace(/\s+$/, '');
  const sep = trimmed && !/;\s*$/.test(trimmed) ? '; ' : (trimmed ? ' ' : '');
  const insertion = sep + property + ': ' + path;
  return source.slice(0, sampleSourceRange.valueStart)
    + trimmed
    + insertion
    + source.slice(valueEnd);
}

const filterEditCases = [
  {
    name: 'counter.html: replace |gt(0) on class.plus with |ge(1)',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.to.property === 'class.plus'),
    nextFilter: '|ge(1)',
    expectFilters: ['ge(1)'],
    expectUntouched: [
      { property: 'class.minus', filters: ['lt(0)'] },
      { property: 'onclick', from: 'decrement' },
    ],
  },
  {
    name: 'counter.html: clear filters on class.plus (empty input)',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.to.property === 'class.plus'),
    nextFilter: '',
    expectFilters: [],
    expectUntouched: [
      { property: 'class.minus', filters: ['lt(0)'] },
    ],
  },
  {
    name: 'counter.html: add a second filter to class.plus (|gt(0)|lc)',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.to.property === 'class.plus'),
    nextFilter: '|gt(0)|lc',
    expectFilters: ['gt(0)', 'lc'],
    expectUntouched: [
      { property: 'class.minus', filters: ['lt(0)'] },
    ],
  },
];

let pass = 0, fail = 0;
for (const tc of cases) {
  const src = readFileSync(resolve(root, tc.file), 'utf8');
  const before = parseHtml(src);
  const wire = tc.pickWire(before);
  if (!wire) {
    console.log(`FAIL: ${tc.name} — could not find target wire`);
    fail++;
    continue;
  }

  const after = deleteBindingFromSource(src, wire.sourceRange);
  const reparsed = parseHtml(after);
  const stillHasGone = reparsed.wires.some(tc.expectGone);
  const missingKept = (tc.expectKept || []).filter(p =>
    !reparsed.wires.some(w => w.to.property === p || w.from.path === p)
  );
  const attrStillThere = tc.expectAttrRemoved && after.includes(tc.expectAttrRemoved);

  const issues = [];
  if (stillHasGone) issues.push('target wire still present after delete');
  if (missingKept.length) issues.push(`expected-kept missing: ${missingKept.join(', ')}`);
  if (attrStillThere) issues.push(`expected attr text "${tc.expectAttrRemoved}" still present`);

  if (issues.length === 0) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    for (const i of issues) console.log(`  - ${i}`);
    console.log('  --- before ---');
    console.log(src.split('\n').map((l, i) => `   ${i + 1}: ${l}`).join('\n'));
    console.log('  --- after ---');
    console.log(after.split('\n').map((l, i) => `   ${i + 1}: ${l}`).join('\n'));
    fail++;
  }
}

for (const tc of invalidationCases) {
  const src = readFileSync(resolve(root, tc.file), 'utf8');
  const before = parseHtml(src);
  const wire = tc.pickWire(before);
  if (!wire) {
    console.log(`FAIL: ${tc.name} — could not find target wire`);
    fail++;
    continue;
  }
  const after = deleteBindingFromSource(src, wire.sourceRange);
  const reparsed = parseHtml(after);
  const invalidPaths = reparsed.wires.filter(w => w.invalid).map(w => w.from.path);
  const missing = tc.expectInvalidPaths.filter(p => !invalidPaths.includes(p));
  const portInvalidCount = reparsed.components
    .flatMap(c => c.ports)
    .filter(p => p.invalid).length;
  if (missing.length === 0 && portInvalidCount > 0) {
    console.log(`PASS: ${tc.name}  (${invalidPaths.length} wires marked invalid, ${portInvalidCount} ports marked invalid)`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    if (missing.length) console.log(`  - expected invalid paths missing: ${missing.join(', ')}`);
    if (portInvalidCount === 0) console.log(`  - no ports marked invalid`);
    console.log(`  - actual invalid wire paths: ${invalidPaths.join(', ') || '(none)'}`);
    fail++;
  }
}

function bindingDeletionEdit(source, sr) {
  if (sr.mustache) {
    return { start: sr.mustacheStart, end: sr.mustacheEnd, replacement: '' };
  }
  const value = source.slice(sr.valueStart, sr.valueEnd);
  const allPieces = splitTopLevelWithPos(value, ';');
  const effective = allPieces.filter(p => p.text.trim());
  if (effective.length <= 1) {
    // Keep `data-wcs=""` as a target slot rather than nuking the attr.
    return { start: sr.valueStart, end: sr.valueEnd, replacement: '' };
  }
  const piece = allPieces[sr.pieceIdx];
  const isLast = sr.pieceIdx === allPieces.length - 1;
  let from, to;
  if (isLast) {
    from = allPieces[sr.pieceIdx - 1].end;
    to = piece.end;
  } else {
    from = piece.start;
    to = allPieces[sr.pieceIdx + 1].start;
    while (to < value.length && /\s/.test(value[to])) to++;
  }
  return { start: sr.valueStart + from, end: sr.valueStart + to, replacement: '' };
}

function insertNewDataWcsAndDelete(source, tagSR, property, movingSR) {
  const movingPath = source.slice(movingSR.pathRange.start, movingSR.pathRange.end);
  const movingFilters = movingSR.filterRange
    ? source.slice(movingSR.filterRange.start, movingSR.filterRange.end)
    : '';
  const movingRhs = movingPath + movingFilters;
  const insertText = ' data-wcs="' + property + ': ' + movingRhs + '"';
  const insertEdit = { start: tagSR.insertPos, end: tagSR.insertPos, replacement: insertText };
  const deleteEdit = bindingDeletionEdit(source, movingSR);
  const edits = [insertEdit, deleteEdit].sort((a, b) => b.start - a.start);
  let result = source;
  for (const e of edits) {
    result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
  }
  return result;
}

function insertNewDataWcs(source, tagSR, property, statePath) {
  const insertText = ' data-wcs="' + property + ': ' + statePath + '"';
  return source.slice(0, tagSR.insertPos) + insertText + source.slice(tagSR.insertPos);
}

function appendDomBindingAndDelete(source, sampleTargetSR, property, movingSR) {
  const movingPath = source.slice(movingSR.pathRange.start, movingSR.pathRange.end);
  const movingFilters = movingSR.filterRange
    ? source.slice(movingSR.filterRange.start, movingSR.filterRange.end)
    : '';
  const movingRhs = movingPath + movingFilters;
  const value = source.slice(sampleTargetSR.valueStart, sampleTargetSR.valueEnd);
  const trimmed = value.replace(/\s+$/, '');
  const sep = trimmed && !/;\s*$/.test(trimmed) ? '; ' : (trimmed ? ' ' : '');
  const newValue = trimmed + sep + property + ': ' + movingRhs;
  const targetEdit = {
    start: sampleTargetSR.valueStart,
    end: sampleTargetSR.valueEnd,
    replacement: newValue,
  };
  const deleteEdit = bindingDeletionEdit(source, movingSR);
  const edits = [targetEdit, deleteEdit].sort((a, b) => b.start - a.start);
  let result = source;
  for (const e of edits) {
    result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
  }
  return result;
}

function rewireDomEndInSource(source, movingSR, targetSR) {
  const movingPath = source.slice(movingSR.pathRange.start, movingSR.pathRange.end);
  const movingFilters = movingSR.filterRange
    ? source.slice(movingSR.filterRange.start, movingSR.filterRange.end)
    : '';
  const movingRhs = movingPath + movingFilters;
  const targetRhsStart = targetSR.pathRange.start;
  const targetRhsEnd = targetSR.filterRange ? targetSR.filterRange.end : targetSR.pathRange.end;
  const edits = [
    { start: targetRhsStart, end: targetRhsEnd, replacement: movingRhs },
    bindingDeletionEdit(source, movingSR),
  ].sort((a, b) => b.start - a.start);
  let result = source;
  for (const e of edits) {
    result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
  }
  return result;
}

// Rewire: change a binding's path text via pathRange splice.
const rewireCases = [
  {
    name: 'counter.html: rewire onclick from `decrement` to `increment`',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.from.path === 'decrement'),
    newPath: 'increment',
    // After rewire there should now be 2 wires referencing increment.
    expect: (g) => g.wires.filter(w => w.from.path === 'increment').length === 2
                 && !g.wires.some(w => w.from.path === 'decrement'),
  },
  {
    name: 'counter.html: rewire class.plus path from `count` to `count`-derived (no-op stays valid)',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.to.property === 'class.plus'),
    newPath: 'count',
    expect: (g) => {
      const w = g.wires.find(x => x.to.property === 'class.plus');
      return w && w.from.path === 'count' && w.filters.join(',') === 'gt(0)';
    },
  },
];

for (const tc of rewireCases) {
  const src = readFileSync(resolve(root, tc.file), 'utf8');
  const before = parseHtml(src);
  const wire = tc.pickWire(before);
  if (!wire || !wire.sourceRange || !wire.sourceRange.pathRange) {
    console.log(`FAIL: ${tc.name} — could not find wire with pathRange`);
    fail++;
    continue;
  }
  const after = rewirePathInSource(src, wire.sourceRange.pathRange, tc.newPath);
  const reparsed = parseHtml(after);
  if (tc.expect(reparsed)) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    console.log('  --- after ---');
    console.log(after.split('\n').slice(15, 25).join('\n'));
    fail++;
  }
}

// DOM-side rewire: move a wire's DOM endpoint to a different port,
// replacing the target's RHS with the moving wire's RHS and deleting
// the moving wire's original binding.
const rewireDomCases = [
  {
    name: 'counter.html: rewire DOM end of class.plus → class.minus (same component, two-piece data-wcs)',
    file: 'examples/counter.html',
    pickMoving: (g) => g.wires.find(w => w.to.property === 'class.plus'),
    pickTarget: (g) => g.wires.find(w => w.to.property === 'class.minus'),
    // Result: class.plus gone, class.minus carries count|gt(0) (moving's RHS)
    expect: (g) => {
      const minus = g.wires.find(w => w.to.property === 'class.minus');
      const plus = g.wires.find(w => w.to.property === 'class.plus');
      return !plus
          && minus
          && minus.from.path === 'count'
          && minus.filters.join(',') === 'gt(0)';
    },
  },
  {
    name: 'counter.html: rewire DOM end of decrement onclick → increment onclick (different components)',
    file: 'examples/counter.html',
    pickMoving: (g) => g.wires.find(w => w.from.path === 'decrement'),
    pickTarget: (g) => g.wires.find(w => w.from.path === 'increment'),
    // After: only `onclick: decrement` on the increment button. Decrement button no longer has its data-wcs.
    expect: (g) => {
      const wires = g.wires.filter(w => w.to.property === 'onclick');
      // One onclick wire remains, bound to decrement, on what was the increment button.
      return wires.length === 1 && wires[0].from.path === 'decrement';
    },
  },
];

for (const tc of rewireDomCases) {
  const src = readFileSync(resolve(root, tc.file), 'utf8');
  const before = parseHtml(src);
  const moving = tc.pickMoving(before);
  const target = tc.pickTarget(before);
  if (!moving || !target) {
    console.log(`FAIL: ${tc.name} — could not find moving/target wires`);
    fail++;
    continue;
  }
  if (!moving.sourceRange?.pathRange || !target.sourceRange?.pathRange) {
    console.log(`FAIL: ${tc.name} — sourceRange.pathRange missing`);
    fail++;
    continue;
  }
  const after = rewireDomEndInSource(src, moving.sourceRange, target.sourceRange);
  const reparsed = parseHtml(after);
  if (tc.expect(reparsed)) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    console.log('  --- after ---');
    console.log(after.split('\n').slice(15, 25).join('\n'));
    console.log('  wires after:', reparsed.wires.map(w => `${w.from.path}|${w.filters.join(',')} -> ${w.to.property}`));
    fail++;
  }
}

function insertMustache(source, tagSR, inner) {
  return source.slice(0, tagSR.tagEnd) + '{{ ' + inner + ' }}' + source.slice(tagSR.tagEnd);
}

function insertMustacheAndDelete(source, tagSR, inner, movingSR) {
  const insertEdit = {
    start: tagSR.tagEnd, end: tagSR.tagEnd, replacement: '{{ ' + inner + ' }}',
  };
  const deleteEdit = bindingDeletionEdit(source, movingSR);
  const edits = [insertEdit, deleteEdit].sort((a, b) => b.start - a.start);
  let result = source;
  for (const e of edits) {
    result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
  }
  return result;
}

// Declared keys appear in state.paths even when no wire references them.
(() => {
  const src = `<!DOCTYPE html>
<html><body>
  <wcs-state><script type="module">
export default {
  count: 0,
  unusedField: 'hello',
  unusedMethod() { return 1; },
  get "items.*.label"() { return ''; },
};
  <\/script></wcs-state>
  <span data-wcs="textContent: count">0</span>
</body></html>`;
  const g = parseHtml(src);
  const s = g.states[0];
  const expectedDeclared = ['count', 'unusedField', 'unusedMethod', 'items.*.label'];
  const missing = expectedDeclared.filter(p => !s.paths.includes(p));
  if (missing.length === 0) {
    console.log('PASS: state hub displays declared-only keys (count, unusedField, unusedMethod, items.*.label)');
    pass++;
  } else {
    console.log('FAIL: declared keys not in state.paths:', missing);
    console.log('  s.paths:', s.paths);
    fail++;
  }
})();

// TEXT-create / TEXT-move: typing "TEXT" as the property name in a
// create or move flow should produce a `{{ ... }}` mustache instead
// of a data-wcs binding.
const inlineEmptyForMustache = `<!DOCTYPE html>
<html>
  <head><script type="module" src="https://esm.run/@wcstack/state/auto"><\/script></head>
  <body>
    <wcs-state><script type="module">export default { greeting: 'Hi', count: 0, inc(){ this.count++; } };<\/script></wcs-state>
    <h2 data-wcs=""></h2>
    <button data-wcs="onclick: inc">+</button>
  </body>
</html>`;

(() => {
  // create-as-TEXT: drag from `greeting` to <h2>, type TEXT
  const before = parseHtml(inlineEmptyForMustache);
  const h2 = before.components.find(c => c.tag === 'h2');
  if (!h2 || !h2.tagSourceRange) {
    console.log('FAIL: TEXT-create — h2 missing tagSourceRange');
    fail++;
  } else {
    const after = insertMustache(inlineEmptyForMustache, h2.tagSourceRange, 'greeting');
    const reparsed = parseHtml(after);
    const w = reparsed.wires.find(w => w.from.path === 'greeting' && w.sourceRange && w.sourceRange.mustache);
    if (w && after.includes('<h2 data-wcs="">{{ greeting }}</h2>')) {
      console.log('PASS: inline: drag-create with property "TEXT" inserts mustache into <h2 data-wcs="">');
      pass++;
    } else {
      console.log('FAIL: TEXT-create — wire missing or source malformed');
      console.log('  --- after ---');
      console.log(after);
      fail++;
    }
  }
})();

(() => {
  // move-as-TEXT: take the existing onclick wire and move it to <h2> as TEXT
  const before = parseHtml(inlineEmptyForMustache);
  const moving = before.wires.find(w => w.from.path === 'inc');
  const h2 = before.components.find(c => c.tag === 'h2');
  if (!moving || !h2 || !h2.tagSourceRange) {
    console.log('FAIL: TEXT-move — missing prerequisites');
    fail++;
    return;
  }
  const movingPath = inlineEmptyForMustache.slice(
    moving.sourceRange.pathRange.start, moving.sourceRange.pathRange.end,
  );
  const movingFilters = moving.sourceRange.filterRange
    ? inlineEmptyForMustache.slice(
        moving.sourceRange.filterRange.start, moving.sourceRange.filterRange.end,
      )
    : '';
  const after = insertMustacheAndDelete(
    inlineEmptyForMustache, h2.tagSourceRange, movingPath + movingFilters, moving.sourceRange,
  );
  const reparsed = parseHtml(after);
  const newMustache = reparsed.wires.find(w => w.from.path === 'inc' && w.sourceRange && w.sourceRange.mustache);
  const oldOnclickGone = !reparsed.wires.some(w => w.from.path === 'inc' && w.to.property === 'onclick');
  if (newMustache && oldOnclickGone) {
    console.log('PASS: inline: move-DOM with property "TEXT" creates mustache, deletes original binding');
    pass++;
  } else {
    console.log('FAIL: TEXT-move — wire layout unexpected');
    console.log('  --- after ---');
    console.log(after);
    fail++;
  }
})();

// Mustache edits: delete, state-side rewire, filter edit.
const inlineMustacheSrc = `<!DOCTYPE html>
<html>
  <head>
    <script type="module" src="https://esm.run/@wcstack/state/auto"><\/script>
  </head>
  <body>
    <wcs-state>
      <script type="module">export default { name: 'Alice', count: 0 };<\/script>
    </wcs-state>
    <p>Hello, {{ name }}! Count: {{ count|gt(0) }}.</p>
  </body>
</html>`;

const mustacheDeleteCases = [
  {
    name: 'inline mustache: delete `{{ name }}` wire',
    src: inlineMustacheSrc,
    pickWire: (g) => g.wires.find(w => w.from.path === 'name' && w.sourceRange && w.sourceRange.mustache),
    expect: (g, after) => !after.includes('{{ name }}') && after.includes('{{ count'),
  },
];

for (const tc of mustacheDeleteCases) {
  const src = tc.src;
  const before = parseHtml(src);
  const wire = tc.pickWire(before);
  if (!wire) {
    console.log(`FAIL: ${tc.name} — could not find target mustache wire`);
    fail++;
    continue;
  }
  const edit = bindingDeletionEdit(src, wire.sourceRange);
  const after = src.slice(0, edit.start) + edit.replacement + src.slice(edit.end);
  if (tc.expect(parseHtml(after), after)) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    console.log('  --- after ---');
    console.log(after);
    fail++;
  }
}

const mustacheRewireCases = [
  {
    name: 'inline mustache: state-side rewire `name` → `count`',
    src: inlineMustacheSrc,
    pickWire: (g) => g.wires.find(w => w.from.path === 'name' && w.sourceRange && w.sourceRange.mustache),
    newPath: 'count',
    expect: (after) => after.includes('{{ count }}') && !after.match(/\{\{\s*name\s*\}\}/),
  },
];

for (const tc of mustacheRewireCases) {
  const src = tc.src;
  const before = parseHtml(src);
  const wire = tc.pickWire(before);
  if (!wire || !wire.sourceRange || !wire.sourceRange.pathRange) {
    console.log(`FAIL: ${tc.name} — missing pathRange`);
    fail++;
    continue;
  }
  const r = wire.sourceRange.pathRange;
  const after = src.slice(0, r.start) + tc.newPath + src.slice(r.end);
  if (tc.expect(after)) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    console.log('  --- after ---');
    console.log(after);
    fail++;
  }
}

const mustacheFilterCases = [
  {
    name: 'inline mustache: replace filter `|gt(0)` with `|ge(1)` in `{{ count|gt(0) }}`',
    src: inlineMustacheSrc,
    pickWire: (g) => g.wires.find(w => w.from.path === 'count' && w.sourceRange && w.sourceRange.mustache),
    newFilter: '|ge(1)',
    expect: (after) => after.includes('{{ count|ge(1) }}'),
  },
];

for (const tc of mustacheFilterCases) {
  const src = tc.src;
  const before = parseHtml(src);
  const wire = tc.pickWire(before);
  if (!wire || !wire.sourceRange || !wire.sourceRange.filterRange) {
    console.log(`FAIL: ${tc.name} — missing filterRange`);
    fail++;
    continue;
  }
  const after = editFilterInSource(src, wire.sourceRange.filterRange, tc.newFilter);
  if (tc.expect(after)) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    console.log('  --- after ---');
    console.log(after);
    fail++;
  }
}

// Property-name edit: rename the property of an existing binding via
// the propertyRange splice (e.g. fix a `onclic` typo to `onclick`).
const propertyEditCases = [
  {
    name: 'counter.html: rename `onclick` → `onmouseover` on decrement button',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.from.path === 'decrement' && w.to.property === 'onclick'),
    newProperty: 'onmouseover',
    expect: (g) => {
      const w = g.wires.find(w => w.from.path === 'decrement');
      return w && w.to.property === 'onmouseover'
          && !g.wires.some(x => x.to.property === 'onclick' && x.from.path === 'decrement');
    },
  },
  {
    name: 'counter.html: rename `class.plus` → `class.positive` keeping filters',
    file: 'examples/counter.html',
    pickWire: (g) => g.wires.find(w => w.to.property === 'class.plus'),
    newProperty: 'class.positive',
    expect: (g) => {
      const w = g.wires.find(w => w.to.property === 'class.positive');
      return w && w.filters.join(',') === 'gt(0)';
    },
  },
];

for (const tc of propertyEditCases) {
  const src = readFileSync(resolve(root, tc.file), 'utf8');
  const before = parseHtml(src);
  const wire = tc.pickWire(before);
  if (!wire || !wire.sourceRange || !wire.sourceRange.propertyRange) {
    console.log(`FAIL: ${tc.name} — could not find wire with propertyRange`);
    fail++;
    continue;
  }
  const r = wire.sourceRange.propertyRange;
  const after = src.slice(0, r.start) + tc.newProperty + src.slice(r.end);
  const reparsed = parseHtml(after);
  if (tc.expect(reparsed)) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    console.log('  --- after ---');
    console.log(after.split('\n').slice(15, 25).join('\n'));
    fail++;
  }
}

// Insert-new-data-wcs: target component has empty data-wcs="" (just a
// "registered slot"), we keep the attribute and append the binding.
// Also covers: a component whose only binding was deleted earlier
// (which now leaves data-wcs="" rather than removing the attribute).
const inlineEmptyAttrSrc = `<!DOCTYPE html>
<html>
  <head>
    <script type="module" src="https://esm.run/@wcstack/state/auto"><\/script>
  </head>
  <body>
    <wcs-state>
      <script type="module">export default { count: 0, inc(){ this.count++; } };<\/script>
    </wcs-state>
    <h1 data-wcs="">Title</h1>
    <button data-wcs="onclick: inc">+</button>
  </body>
</html>`;

const insertNewAttrCases = [
  {
    name: 'inline: move `inc` onclick → <h1 data-wcs=""> as `class.bold` (append into empty value)',
    src: inlineEmptyAttrSrc,
    pickMoving: (g) => g.wires.find(w => w.from.path === 'inc'),
    pickTargetByTag: (g) => g.components.find(c => c.tag === 'h1' && c.ports.length === 0),
    newProperty: 'class.bold',
    expect: (g) => {
      const h1Wires = g.wires.filter(w => w.to.componentId.endsWith(':h1'));
      const has = h1Wires.some(w => w.to.property === 'class.bold' && w.from.path === 'inc');
      const onclickWires = g.wires.filter(w => w.to.property === 'onclick');
      const incGone = !onclickWires.some(w => w.from.path === 'inc');
      return has && incGone;
    },
  },
];

for (const tc of insertNewAttrCases) {
  const src = tc.src || readFileSync(resolve(root, tc.file), 'utf8');
  const before = parseHtml(src);
  const moving = tc.pickMoving(before);
  const target = tc.pickTargetByTag(before);
  if (!moving || !target) {
    console.log(`FAIL: ${tc.name} — could not find moving / target component`);
    fail++;
    continue;
  }
  // For empty-data-wcs targets, prefer appendDomBindingAndDelete
  // (uses the existing valueRange to inject inside the empty quotes).
  // For tagSourceRange-only targets (no data-wcs at all), use
  // insertNewDataWcsAndDelete. Pick based on what the target carries.
  const targetSampleSR = before.wires
    .filter(w => w.to.componentId === target.id && w.sourceRange)[0]?.sourceRange
    // Empty-attr comps have no wires; reach into the parsed attrLocations
    // via getAttribute hack: scan source for the data-wcs attribute that
    // matches this comp's tagSourceRange. For PoC simplicity, fall back
    // to a regex scan.
    || (() => {
      const tagText = src.slice(target.tagSourceRange.tagStart, target.tagSourceRange.tagEnd);
      const m = tagText.match(/data-wcs(\s*=\s*)(["'])([^"']*)\2/);
      if (!m) return null;
      const matchOffset = tagText.indexOf(m[0]);
      const valueStart = target.tagSourceRange.tagStart + matchOffset + m[0].indexOf(m[2]) + 1;
      return {
        attrStart: target.tagSourceRange.tagStart + matchOffset,
        attrEnd: target.tagSourceRange.tagStart + matchOffset + m[0].length,
        valueStart,
        valueEnd: valueStart + m[3].length,
      };
    })();
  const after = targetSampleSR
    ? appendDomBindingAndDelete(src, targetSampleSR, tc.newProperty, moving.sourceRange)
    : insertNewDataWcsAndDelete(src, target.tagSourceRange, tc.newProperty, moving.sourceRange);
  const reparsed = parseHtml(after);
  if (tc.expect(reparsed)) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    console.log('  --- after ---');
    console.log(after);
    fail++;
  }
}

// Move-DOM-to-comp: drop on the comp frame, prompt for property.
// Two paths: (a) property new on target → append; (b) property exists
// on target → replace (same as rewireDomEndInSource).
const moveDomToCompCases = [
  {
    name: 'counter.html: move decrement onclick to span as `disabled` (new property → append)',
    file: 'examples/counter.html',
    pickMoving: (g) => g.wires.find(w => w.from.path === 'decrement'),
    pickTargetSampleWire: (g) => g.wires.find(w => w.to.property === 'class.plus'), // span has data-wcs
    newProperty: 'disabled',
    expect: (g) => {
      // The span comp now should have class.plus, class.minus, AND disabled bound to decrement.
      const spanWires = g.wires.filter(w => w.to.componentId.endsWith(':span'));
      const hasDisabled = spanWires.some(w => w.to.property === 'disabled' && w.from.path === 'decrement');
      const stillHasClassPlus = spanWires.some(w => w.to.property === 'class.plus');
      // The decrement onclick wire should be gone (moving deleted).
      const onclickWires = g.wires.filter(w => w.to.property === 'onclick');
      const decrementGone = !onclickWires.some(w => w.from.path === 'decrement');
      return hasDisabled && stillHasClassPlus && decrementGone;
    },
  },
];

for (const tc of moveDomToCompCases) {
  const src = readFileSync(resolve(root, tc.file), 'utf8');
  const before = parseHtml(src);
  const moving = tc.pickMoving(before);
  const sampleTarget = tc.pickTargetSampleWire(before);
  if (!moving || !sampleTarget) {
    console.log(`FAIL: ${tc.name} — could not find moving/target sample`);
    fail++;
    continue;
  }
  const after = appendDomBindingAndDelete(
    src, sampleTarget.sourceRange, tc.newProperty, moving.sourceRange,
  );
  const reparsed = parseHtml(after);
  if (tc.expect(reparsed)) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    console.log('  --- after ---');
    console.log(after.split('\n').slice(15, 25).join('\n'));
    console.log('  wires:', reparsed.wires.map(w => `${w.from.path}|${w.filters.join(',')} -> ${w.to.componentId}/${w.to.property}`));
    fail++;
  }
}

// Create: append a new binding to an existing data-wcs attribute.
const createCases = [
  {
    name: 'counter.html: add `disabled: count|eq(0)` to a button (sample sourceRange = onclick wire)',
    file: 'examples/counter.html',
    pickSampleWire: (g) => g.wires.find(w => w.from.path === 'decrement' && w.sourceRange),
    property: 'disabled',
    path: 'count',
    // After add, the same component should have two wires (onclick + disabled).
    expect: (g, sampleCompId) => {
      const compWires = g.wires.filter(w => w.to.componentId === sampleCompId);
      return compWires.some(w => w.to.property === 'disabled' && w.from.path === 'count')
          && compWires.some(w => w.to.property === 'onclick');
    },
  },
];

for (const tc of createCases) {
  const src = readFileSync(resolve(root, tc.file), 'utf8');
  const before = parseHtml(src);
  const sampleWire = tc.pickSampleWire(before);
  if (!sampleWire) {
    console.log(`FAIL: ${tc.name} — could not find sample wire`);
    fail++;
    continue;
  }
  const after = appendBindingToValue(src, sampleWire.sourceRange, tc.property, tc.path);
  const reparsed = parseHtml(after);
  // The component id may shift between parses (we use sequential ids),
  // so re-find by the wire that previously existed (onclick decrement).
  const stillThere = reparsed.wires.find(w => w.from.path === 'decrement' && w.to.property === 'onclick');
  if (!stillThere) {
    console.log(`FAIL: ${tc.name} — original wire missing after add`);
    fail++;
    continue;
  }
  const compId = stillThere.to.componentId;
  if (tc.expect(reparsed, compId)) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    console.log('  --- after ---');
    console.log(after.split('\n').slice(15, 25).join('\n'));
    fail++;
  }
}

for (const tc of filterEditCases) {
  const src = readFileSync(resolve(root, tc.file), 'utf8');
  const before = parseHtml(src);
  const wire = tc.pickWire(before);
  if (!wire) {
    console.log(`FAIL: ${tc.name} — could not find target wire`);
    fail++;
    continue;
  }
  if (!wire.sourceRange || !wire.sourceRange.filterRange) {
    console.log(`FAIL: ${tc.name} — wire has no filterRange (sourceRange.filterRange missing)`);
    fail++;
    continue;
  }
  const after = editFilterInSource(src, wire.sourceRange.filterRange, tc.nextFilter);
  const reparsed = parseHtml(after);
  const matched = reparsed.wires.find(w => w.to.property === wire.to.property && w.from.path === wire.from.path);
  if (!matched) {
    console.log(`FAIL: ${tc.name} — target wire missing after edit`);
    fail++;
    continue;
  }

  const issues = [];
  if (JSON.stringify(matched.filters) !== JSON.stringify(tc.expectFilters)) {
    issues.push(`filters: expected ${JSON.stringify(tc.expectFilters)}, got ${JSON.stringify(matched.filters)}`);
  }
  for (const u of tc.expectUntouched || []) {
    const w = reparsed.wires.find(w =>
      w.to.property === u.property && (u.from === undefined || w.from.path === u.from)
    );
    if (!w) {
      issues.push(`expected-untouched wire missing: ${JSON.stringify(u)}`);
      continue;
    }
    if (u.filters !== undefined && JSON.stringify(w.filters) !== JSON.stringify(u.filters)) {
      issues.push(`untouched wire ${u.property} filters changed: expected ${JSON.stringify(u.filters)}, got ${JSON.stringify(w.filters)}`);
    }
  }

  if (issues.length === 0) {
    console.log(`PASS: ${tc.name}`);
    pass++;
  } else {
    console.log(`FAIL: ${tc.name}`);
    for (const i of issues) console.log(`  - ${i}`);
    console.log(`  --- after ---`);
    console.log(after.split('\n').slice(15, 22).join('\n'));
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
