// Graph model → SVG renderer (read-only).
//
// Layout:
//   - State hubs sit in a left column.
//   - Top-level components live in a right column. Structural
//     containers (`for`/`if`) recursively contain their descendants
//     as nested boxes; the container's height grows to hold them and
//     children are inset (CHILD_INDENT) from the container's edges.
//   - Top-level components are sorted by the primary state path they
//     reference; nested children preserve DOM order so loop content
//     stays readable.
//
// Direction is shown via arrowheads:
//   out        — arrow at component side  (state → DOM)
//   in         — arrow at state side      (DOM → state, e.g. on*)
//   inout      — arrows at both ends      (two-way binding)
//   structural — arrow at component side, dashed wire (for/if)
//
// Filter pipelines render as inline chips at the wire midpoint.

const SVG_NS = 'http://www.w3.org/2000/svg';

const STATE_W = 240;
const COMP_W = 280;
const ROW_H = 22;
const HEADER_H = 28;
const NODE_GAP = 36;
const PAD = 16;
const COL_GAP = 240;
const PORT_GAP = 8;        // wire endpoint offset from port circle
const CHILD_INDENT = 18;   // left/right inset of nested children inside a container
const CHILD_PAD = 10;      // top/bottom padding inside container before/after children
const CHILD_GAP = 12;      // vertical gap between sibling children
const MIN_COMP_W = 180;

/**
 * @param {import('./parser.js').GraphModel} graph
 * @param {SVGSVGElement} svg
 * @returns {{ x: number, y: number, w: number, h: number }} natural viewBox
 */
export function renderGraph(graph, svg) {
  clear(svg);
  appendDefs(svg);

  const stateLayouts = layoutColumn(graph.states, s => s.paths.length, PAD + 16);

  const compX = PAD + 16 + STATE_W + COL_GAP;
  const childrenOf = computeChildrenMap(graph.components);
  const topComps = graph.components.filter(c => !c.parentId);
  const orderedTops = orderByPrimaryPath(topComps, graph);
  let cursorY = PAD;
  for (const top of orderedTops) {
    layoutComp(top, compX, cursorY, COMP_W, 0, childrenOf);
    cursorY += top.h + NODE_GAP;
  }
  const compById = new Map(graph.components.map(c => [c.id, c]));
  const stateById = new Map(stateLayouts.map(s => [s.id, s]));

  const totalH = Math.max(bottomOf(stateLayouts), cursorY) + PAD;
  const totalW = compX + COMP_W + PAD;
  const naturalViewBox = { x: 0, y: 0, w: totalW, h: totalH };
  applyViewBox(svg, naturalViewBox);

  if (graph.states.length === 0 && graph.components.length === 0) {
    appendText(svg, totalW / 2, totalH / 2, '(no <wcs-state> or [data-wcs] found)', { class: 'empty-hint', anchor: 'middle' });
    return naturalViewBox;
  }

  // Wires drawn first so they sit underneath nodes. Structural
  // containers use a translucent fill so wires entering nested
  // children remain visible through the parent's body.
  graph.wires.forEach((w, idx) => {
    const s = stateById.get(w.from.stateId);
    const c = compById.get(w.to.componentId);
    if (!s || !c) return;
    const pathIdx = s.paths.indexOf(w.from.path);
    const propIdx = c.ports.findIndex(p => p.property === w.to.property);
    if (pathIdx < 0 || propIdx < 0) return;

    const sx = s.x + STATE_W;
    const sy = s.y + HEADER_H + pathIdx * ROW_H + ROW_H / 2;
    const tx = c.x;
    const ty = c.y + HEADER_H + propIdx * ROW_H + ROW_H / 2;
    const startX = sx + PORT_GAP;
    const endX = tx - PORT_GAP;
    const dx = Math.max(40, (endX - startX) * 0.45);
    const d = `M ${startX} ${sy} C ${startX + dx} ${sy} ${endX - dx} ${ty} ${endX} ${ty}`;
    const stroke = w.invalid ? '#7a7a7a' : wireStroke(w.direction);
    const deletable = !!w.sourceRange;

    const groupCls = `wire-group wire-${w.direction}`
      + (deletable ? ' deletable' : '')
      + (w.invalid ? ' invalid' : '');
    const group = appendEl(svg, 'g', {
      class: groupCls,
      'data-wire-index': idx,
      // Both endpoint coordinates are stored so endpoint-moving mode
      // can pivot the ghost wire from whichever end stays fixed.
      'data-state-end': `${sx},${sy}`,
      'data-comp-end': `${tx},${ty}`,
    });

    // Tooltip explaining why the binding is invalid.
    if (w.invalid) {
      const title = appendEl(group, 'title');
      title.textContent =
        `Invalid binding: relative path "${w.from.path}" has no enclosing for-loop scope. `
        + `Did you remove a surrounding <template data-wcs="for: ...">?`;
    }

    // Hit area: invisible thick stroke for easier clicking/hover.
    appendEl(group, 'path', {
      d,
      fill: 'none',
      stroke: 'transparent',
      'stroke-width': '14',
      class: 'wire-hit',
      'pointer-events': 'stroke',
    });

    // Visible wire path.
    const wireAttrs = {
      d,
      fill: 'none',
      stroke,
      'stroke-width': '1.6',
      class: 'wire',
    };
    if (w.invalid) wireAttrs['stroke-dasharray'] = '3 4';
    else if (w.direction === 'structural') wireAttrs['stroke-dasharray'] = '6 4';
    if (w.direction === 'in' || w.direction === 'inout') wireAttrs['marker-start'] = 'url(#pve-arrow)';
    if (w.direction === 'out' || w.direction === 'inout' || w.direction === 'structural') wireAttrs['marker-end'] = 'url(#pve-arrow)';
    appendEl(group, 'path', wireAttrs);

    const mx = (startX + endX) / 2;
    const my = (sy + ty) / 2;

    if (w.filters && w.filters.length) {
      const editable = deletable && w.sourceRange && w.sourceRange.filterRange;
      appendChip(group, mx, my, '|' + w.filters.join(' | '), editable ? idx : null);
    }

    // Delete affordance (hidden until hover via CSS). Skip for
    // non-deletable wires (mustache). Offset perpendicular to the
    // wire by ~14 px so the icon sits clear of the filter chip,
    // which always lives on the wire's midpoint.
    if (deletable) {
      const dxv = endX - startX;
      const dyv = ty - sy;
      const len = Math.hypot(dxv, dyv) || 1;
      const offset = 14;
      const ix = mx + (dyv / len) * offset;
      const iy = my - (dxv / len) * offset;
      const icon = appendEl(group, 'g', {
        class: 'wire-delete-icon',
        transform: `translate(${ix} ${iy})`,
      });
      // Invisible larger hit area so the cursor doesn't have to land
      // exactly on the visible disc, and so the user can travel from
      // the wire to the icon without losing hover (the buffer reaches
      // back toward the wire-hit stroke).
      appendEl(icon, 'circle', { r: 14, class: 'delete-hit' });
      appendEl(icon, 'circle', { r: 9, class: 'delete-bg' });
      appendEl(icon, 'path', {
        d: 'M -3.5 -3.5 L 3.5 3.5 M -3.5 3.5 L 3.5 -3.5',
        class: 'delete-x',
      });

    }
  });

  // State hubs.
  for (const s of stateLayouts) {
    const g = appendEl(svg, 'g', { class: 'state-node', transform: `translate(${s.x}, ${s.y})` });
    appendEl(g, 'rect', { x: 0, y: 0, width: STATE_W, height: s.h, rx: 8, class: 'state-bg' });
    appendText(g, 12, HEADER_H / 2 + 5, `<wcs-state> ${s.name}`, { class: 'state-title' });
    if (s.paths.length === 0) {
      appendText(g, 12, HEADER_H + 16, '(no bindings reference this state)', { class: 'port-label dim' });
    }
    s.paths.forEach((p, i) => {
      const py = HEADER_H + i * ROW_H + ROW_H / 2;
      const isWildcard = p.includes('*');
      const isInvalid = p.startsWith('.');
      const portCls = 'port-out'
        + (isWildcard ? ' wildcard' : '')
        + (isInvalid ? ' invalid' : '');
      const labelCls = 'port-label'
        + (isWildcard ? ' wildcard' : '')
        + (isInvalid ? ' invalid' : '');
      // Wrap the row so the entire row (label + dot + gap) is a single
      // drag source AND drop target. Without this the user has to hit
      // a 4 px circle.
      // data-port-x/y are absolute SVG-viewBox coordinates of the
      // port circle; create-drag uses them as the ghost-wire origin
      // (more reliable than recomputing via getCTM at click time).
      const rowG = appendEl(g, 'g', {
        class: 'state-port-row',
        'data-state-id': s.id,
        'data-state-path': p,
        'data-port-x': s.x + STATE_W,
        'data-port-y': s.y + py,
      });
      appendEl(rowG, 'rect', {
        x: 0,
        y: HEADER_H + i * ROW_H,
        width: STATE_W + 10,
        height: ROW_H,
        class: 'port-hit',
      });
      appendEl(rowG, 'circle', { cx: STATE_W, cy: py, r: 4, class: portCls });
      appendText(rowG, STATE_W - 10, py + 4, p, { class: labelCls, anchor: 'end' });
    });
  }

  // Component nodes. Iteration order is parser-insertion order which is
  // depth-first DOM order, so structural parents render before their
  // children — children get drawn on top of the parent's translucent body.
  for (const c of graph.components) {
    renderComponent(c, svg, !!childrenOf.get(c.id));
  }

  return naturalViewBox;
}

function renderComponent(c, svg, hasChildren) {
  const isUnbound = c.unbound === true;
  const cls = 'comp-node'
    + (c.structural ? ' structural' : '')
    + (hasChildren ? ' has-children' : '')
    + (isUnbound ? ' unbound' : '');
  const g = appendEl(svg, 'g', {
    class: cls,
    transform: `translate(${c.x}, ${c.y})`,
    'data-comp-id': c.id,
    'data-comp-tag': c.tag,
  });
  appendEl(g, 'rect', { x: 0, y: 0, width: c.w, height: c.h, rx: 8, class: 'comp-bg' });

  const title = c.structural ? `<${c.tag}> ${c.structuralKind}` : `<${c.tag}>`;
  appendText(g, 12, HEADER_H / 2 + 5, title, { class: 'comp-title' });

  const portRows = Math.max(c.ports.length, 1);
  const portsBottom = HEADER_H + portRows * ROW_H + 8;

  c.ports.forEach((p, i) => {
    const py = HEADER_H + i * ROW_H + ROW_H / 2;
    const portClass = `port-${p.kind}`
      + (p.wildcard ? ' wildcard' : '')
      + (p.invalid ? ' invalid' : '');
    const mod = p.modifier ? `#${p.modifier}` : '';
    const label = (p.label || p.property) + mod;
    const labelClass = 'port-label'
      + (p.mustache ? ' mustache' : '')
      + (p.wildcard ? ' wildcard' : '')
      + (p.invalid ? ' invalid' : '');
    // Wrap port + label in a row group so the entire row is a click
    // target (not just the 4px circle). Mustache ports are tagged so
    // the click handler can reject them as rewire targets.
    const rowG = appendEl(g, 'g', {
      class: 'comp-port-row' + (p.mustache ? ' mustache' : ''),
      'data-comp-id': c.id,
      'data-port-property': p.property,
    });
    appendEl(rowG, 'rect', {
      x: -8,
      y: HEADER_H + i * ROW_H,
      width: c.w + 8,
      height: ROW_H,
      class: 'port-hit',
    });
    appendEl(rowG, 'circle', { cx: 0, cy: py, r: 4, class: portClass });
    appendText(rowG, 10, py + 4, label, { class: labelClass });
  });

  // Separator between this container's own ports and its nested
  // children area (only when the container actually has children).
  if (hasChildren) {
    appendEl(g, 'line', {
      x1: 10,
      y1: portsBottom,
      x2: c.w - 10,
      y2: portsBottom,
      class: 'child-separator',
    });
  }
}

function layoutComp(c, x, y, w, depth, childrenOf) {
  c.x = x;
  c.y = y;
  c.w = w;
  c.depth = depth;

  // Unbound comps render compactly: just the header bar + a couple of
  // pixels of padding. Bound comps reserve a row per port.
  const isUnbound = c.unbound === true;
  const ownContentH = isUnbound
    ? HEADER_H + 4
    : HEADER_H + Math.max(c.ports.length, 1) * ROW_H + 8;

  const children = childrenOf.get(c.id) || [];
  if (!c.structural || children.length === 0) {
    c.h = ownContentH;
    return c.h;
  }

  const childX = x + CHILD_INDENT;
  const childW = Math.max(MIN_COMP_W, w - 2 * CHILD_INDENT);
  let yc = y + ownContentH + CHILD_PAD;
  for (const ch of children) {
    const chH = layoutComp(ch, childX, yc, childW, depth + 1, childrenOf);
    yc += chH + CHILD_GAP;
  }
  yc -= CHILD_GAP;          // strip the trailing gap after the last child
  c.h = (yc + CHILD_PAD) - y;
  return c.h;
}

function computeChildrenMap(components) {
  const map = new Map();
  for (const c of components) {
    if (!c.parentId) continue;
    if (!map.has(c.parentId)) map.set(c.parentId, []);
    map.get(c.parentId).push(c);
  }
  return map;
}

function orderByPrimaryPath(components, graph) {
  const firstState = graph.states[0];
  if (!firstState) return components.slice();
  const paths = firstState.paths;
  const primaryIdx = (c) => {
    let bestPath = null;
    let best = 0;
    const counts = new Map();
    for (const w of graph.wires) {
      if (w.to.componentId !== c.id) continue;
      const n = (counts.get(w.from.path) || 0) + 1;
      counts.set(w.from.path, n);
      if (n > best) { best = n; bestPath = w.from.path; }
    }
    if (bestPath == null) return Infinity;
    const idx = paths.indexOf(bestPath);
    return idx >= 0 ? idx : Infinity;
  };
  const originalIdx = new Map(components.map((c, i) => [c.id, i]));
  return components.slice().sort((a, b) => {
    const pa = primaryIdx(a);
    const pb = primaryIdx(b);
    if (pa !== pb) return pa - pb;
    return originalIdx.get(a.id) - originalIdx.get(b.id);
  });
}

function appendDefs(svg) {
  const defs = appendEl(svg, 'defs');
  const marker = appendEl(defs, 'marker', {
    id: 'pve-arrow',
    viewBox: '0 0 10 10',
    refX: '9',
    refY: '5',
    markerWidth: '8',
    markerHeight: '8',
    orient: 'auto-start-reverse',
    markerUnits: 'userSpaceOnUse',
  });
  // The thin canvas-colored stroke gives the arrow a clear silhouette
  // against the wire stroke that runs underneath it; without it the
  // arrow body merges into a thick wire on hover.
  appendEl(marker, 'path', {
    d: 'M 0 0 L 10 5 L 0 10 Z',
    fill: 'context-stroke',
    stroke: '#141414',
    'stroke-width': '0.8',
    'stroke-linejoin': 'miter',
  });
}

function layoutColumn(items, portCount, x) {
  const out = [];
  let y = PAD;
  for (const item of items) {
    const rows = Math.max(portCount(item), 1);
    const h = HEADER_H + rows * ROW_H + 10;
    out.push({ ...item, x, y, h });
    y += h + NODE_GAP;
  }
  return out;
}

function bottomOf(layouts) {
  if (layouts.length === 0) return 200;
  const last = layouts[layouts.length - 1];
  return last.y + last.h;
}

function wireStroke(direction) {
  if (direction === 'in') return '#e8a23a';
  if (direction === 'inout') return '#34c8b1';
  if (direction === 'structural') return '#9966cc';
  return '#4a90e2';
}

function applyViewBox(svg, vb) {
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svg.setAttribute('width', String(vb.w));
  svg.setAttribute('height', String(vb.h));
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function appendEl(parent, name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent.appendChild(el);
  return el;
}

function appendText(parent, x, y, text, opts = {}) {
  const t = appendEl(parent, 'text', {
    x, y,
    class: opts.class || '',
    ...(opts.anchor ? { 'text-anchor': opts.anchor } : {}),
  });
  t.textContent = text;
  return t;
}

function appendChip(parent, cx, cy, label, wireIdx) {
  const chip = appendEl(parent, 'g', {
    class: 'filter-chip' + (wireIdx == null ? '' : ' editable'),
    ...(wireIdx == null ? {} : { 'data-wire-index': wireIdx }),
  });
  const t = appendEl(chip, 'text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'filter-text' });
  t.textContent = label;
  requestAnimationFrame(() => {
    try {
      const bb = t.getBBox();
      const padX = 6;
      const padY = 2;
      // Visible background.
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', String(bb.x - padX));
      bg.setAttribute('y', String(bb.y - padY));
      bg.setAttribute('width', String(bb.width + padX * 2));
      bg.setAttribute('height', String(bb.height + padY * 2));
      bg.setAttribute('rx', '4');
      bg.setAttribute('class', 'filter-bg');
      chip.insertBefore(bg, t);
      // Invisible hit area for editable chips, slightly larger than
      // the visible rect for forgiving click targets. Inserted BEHIND
      // the visible rect so it doesn't paint over it.
      if (wireIdx != null) {
        const hit = document.createElementNS(SVG_NS, 'rect');
        hit.setAttribute('x', String(bb.x - padX - 4));
        hit.setAttribute('y', String(bb.y - padY - 4));
        hit.setAttribute('width', String(bb.width + padX * 2 + 8));
        hit.setAttribute('height', String(bb.height + padY * 2 + 8));
        hit.setAttribute('class', 'filter-hit');
        chip.insertBefore(hit, bg);
      }
    } catch (_) {
      // getBBox can fail on detached nodes; ignore.
    }
  });
}
