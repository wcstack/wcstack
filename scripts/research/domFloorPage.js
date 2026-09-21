// Page-side operations for scripts/audit-state-tech-dom.mjs. Inlined into a synthetic page
// after `import { buildData } from '@lib/buildData';`. No wcstack runtime is present: this is
// the DOM-only floor for the operations the benchmark fixture drives.
const tbody = document.querySelector('tbody');
const proto = document.getElementById('row').content.firstChild;
let rows = [];
let pool = [];
const timed = (op, done) => new Promise((res, rej) => {
  const timer = setTimeout(() => { mo.disconnect(); rej(new Error('DOM timeout')); }, 30000);
  const mo = new MutationObserver(() => {
    if (!done()) return;
    mo.disconnect(); clearTimeout(timer); res(performance.now() - start);
  });
  mo.observe(tbody, { childList: true, subtree: true, attributes: true, characterData: true });
  const start = performance.now();
  op();
});
const count = n => () => tbody.childElementCount === n;
const resolvers = {
  path: tr => [tr.childNodes[0].firstChild, tr.childNodes[1].firstChild.firstChild],
  qsa: tr => { const m = tr.querySelectorAll('[data-b]'); return [m[0].firstChild, m[1].firstChild]; },
  walker: tr => { const w = document.createTreeWalker(tr, NodeFilter.SHOW_TEXT); const out = []; let t; while ((t = w.nextNode())) if (t.data === '#') out.push(t); return out; },
};
function createRows(data, { make = 'clone', resolve = 'path', batch = 'fragment', records = false } = {}) {
  const res = resolvers[resolve];
  const target = batch === 'fragment' ? document.createDocumentFragment() : tbody;
  const recs = records ? [] : null;
  for (let i = 0; i < data.length; i++) {
    const tr = make === 'import' ? document.importNode(proto, true) : proto.cloneNode(true);
    const nodes = res(tr);
    nodes[0].data = data[i].id; nodes[1].data = data[i].label;
    if (recs) recs.push({ node: nodes[0], value: data[i].id }, { node: nodes[1], value: data[i].label });
    target.appendChild(tr); rows.push(tr);
  }
  if (batch === 'fragment') tbody.appendChild(target);
  window.__records = recs;
}
function createHTML(data) {
  let s = '';
  for (const d of data) s += `<tr><td class="col-md-1">${d.id}</td><td class="col-md-4"><a>${d.label}</a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td></tr>`;
  tbody.insertAdjacentHTML('beforeend', s);
  rows = Array.from(tbody.children);
}
function createElements(data) {
  const frag = document.createDocumentFragment();
  for (const d of data) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); td1.className = 'col-md-1'; td1.appendChild(document.createTextNode(d.id));
    const td2 = document.createElement('td'); td2.className = 'col-md-4'; const a = document.createElement('a'); a.appendChild(document.createTextNode(d.label)); td2.appendChild(a);
    const td3 = document.createElement('td'); td3.className = 'col-md-1'; const a2 = document.createElement('a'); const span = document.createElement('span'); span.className = 'glyphicon glyphicon-remove'; span.setAttribute('aria-hidden', 'true'); a2.appendChild(span); td3.appendChild(a2);
    const td4 = document.createElement('td'); td4.className = 'col-md-6';
    tr.append(td1, td2, td3, td4); frag.appendChild(tr); rows.push(tr);
  }
  tbody.appendChild(frag);
}
function createFromPool(data) {
  const frag = document.createDocumentFragment();
  for (const d of data) {
    const tr = pool.length ? pool.pop() : proto.cloneNode(true);
    const nodes = resolvers.path(tr);
    nodes[0].data = d.id; nodes[1].data = d.label; tr.className = '';
    frag.appendChild(tr); rows.push(tr);
  }
  tbody.appendChild(frag);
}
// Bookkeeping-shape models for the row-record fold (survey §10 item 2). The same DOM clone
// and text writes, with different per-row bookkeeping on top:
//   none     clone + text only (the DOM floor)
//   current  what the runtime does per plan row today: per binding a spread copy of the slot
//            template (10 fields), a 25-field record and the ledgers touched per binding
//            (recordByBinding WeakMap, records Set, optionsByBinding WeakMap, interested
//            WeakMap(node → Set), knownRow Map, markNode WeakSet), plus per row a content
//            object and five content ledgers
//   folded   one row object holding nodes, values, list index and the mutable record fields,
//            one WeakMap set and one Set add per row
const SLOT_TEMPLATES = [
  { propName: 'class.danger', propSegments: ['class', 'danger'], propModifiers: [], statePathName: '.selected', statePathInfo: null, inFilters: [], outFilters: [], bindingType: 'prop', uuid: 'row' },
  { propName: 'textContent', propSegments: ['textContent'], propModifiers: [], statePathName: '.id', statePathInfo: null, inFilters: [], outFilters: [], bindingType: 'text', uuid: 'row' },
  { propName: 'textContent', propSegments: ['textContent'], propModifiers: [], statePathName: '.label', statePathInfo: null, inFilters: [], outFilters: [], bindingType: 'text', uuid: 'row' },
];
const SESSION = { id: 'session' };
const ROW_OPTIONS = { registerAddress: false, registerPathInfo: false, applyOnReconnect: false };
const POLICY = { outputOnly: false };
let nextRecordId = 0, nextGeneration = 0;
const ledgers = {
  recordByBinding: new WeakMap(), records: new Set(), optionsByBinding: new WeakMap(), interested: new WeakMap(), knownRow: new Map(), marked: new WeakSet(),
  contentByNode: new WeakMap(), sessionByContent: new WeakMap(), bindingsByContent: new WeakMap(), indexBindingsByContent: new WeakMap(), nodesByContent: new WeakMap(),
  rowByNode: new WeakMap(), rowSet: new Set(),
};
function bookkeepCurrent(tr, nodes, d) {
  const targets = [tr, nodes[0], nodes[1]];
  const content = { fragment: null, ranged: false };
  const bindings = new Array(3);
  for (let k = 0; k < 3; k++) {
    const node = targets[k];
    const binding = { ...SLOT_TEMPLATES[k], node, replaceNode: node };
    bindings[k] = binding;
    const record = { id: ++nextRecordId, info: binding, generation: ++nextGeneration, phase: 'active', teardowns: null, session: SESSION, anchor: node, options: ROW_OPTIONS,
      address: null, patternPathInfo: null, patternListIndex: null, pendingDefinitions: 0, initialPolicy: POLICY, resolvedAuthority: 'state', initialSettled: true, initialApplyDone: false,
      outputOnlyMember: false, observationPending: false, eventSequence: 0, hasProducerValue: false, producerValue: undefined, eventAttached: false, twowayAttached: false };
    ledgers.recordByBinding.set(binding, record);
    ledgers.records.add(record);
    ledgers.optionsByBinding.set(binding, ROW_OPTIONS);
    let set = ledgers.interested.get(node);
    if (!set) ledgers.interested.set(node, set = new Set());
    set.add(SESSION);
    ledgers.knownRow.set(binding, k);
    ledgers.marked.add(node);
  }
  ledgers.contentByNode.set(tr, content);
  ledgers.sessionByContent.set(content, SESSION);
  ledgers.bindingsByContent.set(content, bindings);
  ledgers.indexBindingsByContent.set(content, []);
  ledgers.nodesByContent.set(content, nodes);
}
function bookkeepFolded(tr, nodes, d, i) {
  const row = { tr, nodes, values: [false, d.id, d.label], listIndex: i, phase: 1, generation: ++nextGeneration, eventAttached: false };
  ledgers.rowByNode.set(tr, row);
  ledgers.rowSet.add(row);
}
function createShaped(data, shape) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < data.length; i++) {
    const tr = proto.cloneNode(true);
    const nodes = resolvers.path(tr);
    nodes[0].data = data[i].id; nodes[1].data = data[i].label;
    if (shape === 'current') bookkeepCurrent(tr, nodes, data[i]);
    else if (shape === 'folded') bookkeepFolded(tr, nodes, data[i], i);
    frag.appendChild(tr); rows.push(tr);
  }
  tbody.appendChild(frag);
}
const clears = {
  replaceChildren: () => tbody.replaceChildren(),
  textContent: () => { tbody.textContent = ''; },
  innerHTML: () => { tbody.innerHTML = ''; },
  range: () => { const r = document.createRange(); r.selectNodeContents(tbody); r.deleteContents(); },
  removeLast: () => { while (tbody.lastChild) tbody.lastChild.remove(); },
  removeFirst: () => { while (tbody.firstChild) tbody.removeChild(tbody.firstChild); },
  pool: () => tbody.replaceChildren(),
};
function swapRows(variant) {
  const a = rows[1], b = rows[998];
  const bNext = b.nextSibling;
  if (variant === 'moveBefore') { tbody.moveBefore(b, a); tbody.moveBefore(a, bNext); }
  else { tbody.insertBefore(b, a); tbody.insertBefore(a, bNext); }
  rows[1] = b; rows[998] = a;
}
window.bench = {
  ready: true,
  moveBeforeAvailable: typeof Element.prototype.moveBefore === 'function',
  rows: () => rows.length,
  create(n, opts = {}) {
    const data = buildData(n);
    const expect = rows.length + n;
    const fn = opts.make === 'html' ? () => createHTML(data) : opts.make === 'element' ? () => createElements(data)
      : opts.make === 'pool' ? () => createFromPool(data) : () => createRows(data, opts);
    return timed(fn, count(expect));
  },
  createShaped(n, shape) {
    const data = buildData(n);
    const expect = rows.length + n;
    return timed(() => createShaped(data, shape), count(expect));
  },
  ledgerSizes: () => ({ records: ledgers.records.size, knownRow: ledgers.knownRow.size, rowSet: ledgers.rowSet.size }),
  clear(variant) {
    if (tbody.childElementCount === 0) return Promise.resolve(0);
    const detached = rows; rows = [];
    return timed(() => { clears[variant](); if (variant === 'pool') pool = detached; }, count(0));
  },
  update(variant) {
    return timed(() => {
      for (let i = 0; i < rows.length; i += 10) {
        const a = rows[i].childNodes[1].firstChild;
        if (variant === 'data') a.firstChild.data += ' !!!';
        else if (variant === 'nodeValue') a.firstChild.nodeValue += ' !!!';
        else a.textContent += ' !!!';
      }
    }, () => true);
  },
  select(variant, i) {
    const prev = tbody.querySelector('tr.danger');
    return timed(() => {
      if (variant === 'classList') { prev?.classList.remove('danger'); rows[i].classList.add('danger'); }
      else { if (prev) prev.className = ''; rows[i].className = 'danger'; }
    }, () => true);
  },
  swap(variant) { return timed(() => swapRows(variant), () => true); },
  remove(i) { const expect = rows.length - 1; return timed(() => { rows[i].remove(); rows.splice(i, 1); }, count(expect)); },
  moveProbe(variant) {
    if (variant === 'moveBefore' && !this.moveBeforeAvailable) return { available: false };
    if (!customElements.get('x-probe')) customElements.define('x-probe', class extends HTMLElement {
      connectedCallback() { this.connects = (this.connects ?? 0) + 1; }
      disconnectedCallback() { this.disconnects = (this.disconnects ?? 0) + 1; }
    });
    const cell = rows[1].lastElementChild;
    const input = document.createElement('input'); input.value = 'typed'; cell.appendChild(input);
    const probe = document.createElement('x-probe'); cell.appendChild(probe);
    input.focus(); input.setSelectionRange(1, 3);
    const before = { focused: document.activeElement === input, connects: probe.connects ?? 0, disconnects: probe.disconnects ?? 0 };
    swapRows(variant);
    const after = { focused: document.activeElement === input, connects: probe.connects ?? 0, disconnects: probe.disconnects ?? 0,
      value: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd };
    input.remove(); probe.remove();
    return { available: true, before, after };
  },
};
