// <pve-graph> custom element: wraps the parser+renderer pipeline so
// it can be driven via a single `source` property. wcstack's
// `data-wcs="source: htmlSource"` invokes the setter every time the
// bound state path changes.
//
// Adds pan & zoom on top of the static renderer:
//   - mouse wheel       : zoom toward cursor
//   - drag (left button): pan
//   - double-click      : reset (fit to content)
//   - "Fit" button      : reset (fit to content)
// View state is preserved across re-renders so editing the source
// doesn't snap the user back to the default view. The very first
// render fits to content.

import { parseHtml } from './parser.js';
import { renderGraph } from './render.js';

const TEMPLATE = `
<style>
  :host {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #141414;
    cursor: grab;
    touch-action: none;
  }
  :host(.panning) { cursor: grabbing; }
  svg { display: block; width: 100%; height: 100%; }
  .state-bg { fill: #2c3e50; stroke: #4a90e2; stroke-width: 1.5; }
  .comp-bg { fill: #232323; stroke: #555; stroke-width: 1; }
  /* Structural containers use a translucent fill so wires that pass
     into nested children stay visible through the parent's body. */
  .comp-node.structural .comp-bg { fill: rgba(60, 50, 75, 0.45); stroke: #9966cc; stroke-dasharray: 4 3; }
  .comp-node.structural.has-children .comp-bg { fill: rgba(60, 50, 75, 0.32); }
  .child-separator { stroke: #555; stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6; }
  /* Unbound comps: compact box, dashed gray border, dim text. They
     exist in the graph as "potential targets" the user can rewire to. */
  .comp-node.unbound .comp-bg { fill: rgba(35, 35, 35, 0.6); stroke: #555; stroke-dasharray: 3 3; }
  .comp-node.unbound .comp-title { fill: #999; font-size: 11px; font-weight: 500; }
  .state-title, .comp-title { fill: #fff; font: 600 13px ui-monospace, monospace; }
  .port-label { fill: #ddd; font: 11px ui-monospace, monospace; }
  .port-label.dim { fill: #666; font-style: italic; }
  .port-label.wildcard { fill: #b8b86a; font-style: italic; }
  .port-label.mustache { fill: #aaa; font-style: italic; }
  .port-out, .port-in { fill: #4a90e2; }
  .port-event { fill: #e8a23a; }
  .port-structural { fill: #9966cc; }
  .port-out.wildcard, .port-in.wildcard { fill: #b8b86a; stroke: #6a6a3a; stroke-width: 1; }
  /* Invalid bindings — orphan relative paths or unresolved wildcards. */
  .port-out.invalid,
  .port-in.invalid,
  .port-event.invalid,
  .port-structural.invalid { fill: #5a5a5a; stroke: #444; stroke-width: 1; }
  .port-label.invalid { fill: #777; font-style: italic; }
  .wire-group.invalid .wire { opacity: 0.5; }
  .wire-group.invalid.deletable:hover .wire { opacity: 0.85; }

  /* Drag handles for create. Rewire is now click-to-select. */
  .state-port-row { cursor: grab; }
  .state-port-row .port-hit { fill: transparent; pointer-events: all; }
  .comp-port-row .port-hit { fill: transparent; pointer-events: all; }
  :host(.wire-dragging) .state-port-row { cursor: grabbing; }
  :host(.wire-dragging) { cursor: grabbing; }

  /* Drag drop-hover (used during create-drag only) */
  .state-port-row.drop-hover .port-hit {
    fill: rgba(255, 235, 59, 0.18);
  }
  .state-port-row.drop-hover .port-out {
    fill: #ffeb3b;
    stroke: #fff;
    stroke-width: 2;
  }
  .state-port-row.drop-hover .port-label {
    fill: #fff;
  }
  .comp-node.drop-hover .comp-bg {
    stroke: #ffeb3b;
    stroke-width: 2;
  }

  /* Click-to-select wire. The hit-stroke is widened to make selection
     forgiving on thin wires. */
  .wire-hit { cursor: pointer; }
  .wire-group.selected .wire {
    stroke-width: 3.2;
    opacity: 1;
    stroke-dasharray: 8 4;
  }
  /* Animation direction follows the wire's data-flow direction.
     out / inout / structural flow state→DOM (forward).
     in flows DOM→state (reverse). */
  .wire-group.selected.wire-out .wire,
  .wire-group.selected.wire-inout .wire,
  .wire-group.selected.wire-structural .wire {
    animation: wire-march-fwd 700ms linear infinite;
  }
  .wire-group.selected.wire-in .wire {
    animation: wire-march-rev 700ms linear infinite;
  }
  .wire-group.selected.wire-structural .wire {
    stroke-dasharray: 10 5;
  }
  @keyframes wire-march-fwd { to { stroke-dashoffset: -24; } }
  @keyframes wire-march-rev { to { stroke-dashoffset:  24; } }

  /* The wire's two endpoints (the rows in state hub and component) are
     highlighted whenever the wire is selected — they're the only valid
     trigger points for entering MOVING_* mode. */
  .endpoint-selected .port-hit { fill: rgba(255, 235, 59, 0.16); }
  .endpoint-selected .port-out,
  .endpoint-selected .port-in,
  .endpoint-selected .port-event,
  .endpoint-selected .port-structural {
    stroke: #ffeb3b;
    stroke-width: 2;
  }
  .endpoint-selected .port-label { fill: #fff; }

  /* Hover affordance while a wire is selected — non-endpoint rows are
     still visible but don't beg for clicks. Mustache ports show
     rejection cursor for clarity. */
  :host(.has-selection) .endpoint-selected { cursor: pointer; }
  :host(.has-selection) .endpoint-selected:hover .port-hit {
    fill: rgba(255, 235, 59, 0.30);
  }

  /* MOVING modes: cursor indicates we're carrying an endpoint.
     The selected wire's original path fades so the live ghost is the
     visual focus. Only valid drop targets light up on hover. */
  :host(.moving-state),
  :host(.moving-dom) { cursor: crosshair; }
  :host(.moving-state) .wire-group.selected .wire,
  :host(.moving-dom) .wire-group.selected .wire { opacity: 0.18; }

  :host(.moving-state) .state-port-row:hover .port-hit {
    fill: rgba(255, 235, 59, 0.20);
  }
  :host(.moving-state) .state-port-row:hover .port-out {
    fill: #ffeb3b; stroke: #fff; stroke-width: 2;
  }

  /* Receivable comp frames: a single binding per property is enforced
     by funneling the move through the comp frame + property prompt
     instead of letting the user click an already-bound port. */
  :host(.moving-dom) .comp-node.receivable .comp-bg {
    stroke: rgba(255, 235, 59, 0.55);
    stroke-width: 2;
    stroke-dasharray: none;
  }
  :host(.moving-dom) .comp-node.receivable.structural .comp-bg {
    stroke-dasharray: 4 3;
  }
  :host(.moving-dom) .comp-node.receivable:hover .comp-bg {
    stroke: #ffeb3b;
    stroke-width: 3;
  }
  :host(.moving-dom) .comp-node.receivable { cursor: pointer; }
  /* Non-receivable comps in MOVING_DOM are dimmed so the eye is drawn
     to viable targets only. */
  :host(.moving-dom) .comp-node:not(.receivable) { opacity: 0.45; }
  :host(.moving-dom) .comp-node:not(.receivable) .comp-port-row { cursor: not-allowed; }

  /* Ghost wire while dragging */
  .ghost-wire {
    stroke: #ffeb3b;
    stroke-width: 1.6;
    stroke-dasharray: 4 3;
    opacity: 0.85;
    pointer-events: none;
  }
  .wire { opacity: 0.9; pointer-events: none; }
  .wire-group.deletable { cursor: pointer; }
  .wire-hit { fill: none; }
  .wire-group.deletable:hover .wire { stroke-width: 2.4; opacity: 1; }
  /* Delete icon is shown only while a wire is in the SELECTED state.
     :host(.has-selection) is set on wire-selected and cleared in
     MOVING modes, so this single rule covers:
       - NORMAL  → hidden (no has-selection)
       - SELECTED → shown (has-selection + .selected on this wire)
       - MOVING_* → hidden (has-selection cleared) */
  .wire-delete-icon { display: none; }
  :host(.has-selection) .wire-group.selected.deletable .wire-delete-icon {
    display: block;
  }
  /* Invisible hit-buffer around the icon so a near-miss still counts. */
  .wire-delete-icon .delete-hit { fill: transparent; pointer-events: all; }
  .wire-delete-icon .delete-bg { fill: #d44; stroke: #fff; stroke-width: 1; pointer-events: all; }
  .wire-delete-icon .delete-x { stroke: #fff; stroke-width: 1.5; fill: none; pointer-events: none; }
  .filter-text { fill: #ddd; font: 10px ui-monospace, monospace; pointer-events: none; }
  .filter-bg { fill: #1d1d1d; stroke: #555; stroke-width: 1; pointer-events: none; }
  /* Editable filter chip: a transparent hit rect catches clicks; the
     visible parts stay non-interactive so they don't compete. */
  .filter-hit { fill: transparent; cursor: text; pointer-events: all; }
  .filter-chip.editable:hover .filter-bg { stroke: #aaa; }
  .filter-chip.editable:hover .filter-text { fill: #fff; }
  .empty-hint { fill: #666; font: italic 13px ui-monospace, monospace; }
  .error { fill: #e44; font: 12px ui-monospace, monospace; }

  /* Mode hint shown while a wire is selected or being moved. */
  .selection-hint {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 12px;
    background: rgba(255, 235, 59, 0.92);
    color: #1a1a1a;
    font: 11px ui-monospace, monospace;
    border-radius: 4px;
    pointer-events: none;
    display: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
  }
  :host(.has-selection) .selection-hint.hint-selected,
  :host(.moving-state) .selection-hint.hint-moving-state,
  :host(.moving-dom) .selection-hint.hint-moving-dom {
    display: block;
  }

  .controls {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: flex;
    gap: 6px;
    pointer-events: none;
  }
  .controls button {
    pointer-events: auto;
    background: #232323;
    color: #ddd;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    padding: 4px 10px;
    font: 11px ui-monospace, monospace;
    cursor: pointer;
  }
  .controls button:hover { background: #2c2c2c; }
  .legend {
    position: absolute;
    left: 10px;
    bottom: 10px;
    padding: 6px 10px;
    background: rgba(20, 20, 20, 0.85);
    border: 1px solid #2a2a2a;
    border-radius: 4px;
    font: 10px ui-monospace, monospace;
    color: #aaa;
    pointer-events: none;
    display: grid;
    grid-template-columns: 12px auto;
    gap: 2px 6px;
    align-items: center;
  }
  .legend .swatch { width: 12px; height: 2px; border-radius: 1px; }
</style>
<svg xmlns="http://www.w3.org/2000/svg"></svg>
<div class="legend">
  <span class="swatch" style="background:#4a90e2"></span><span>state → DOM (out)</span>
  <span class="swatch" style="background:#e8a23a"></span><span>DOM → state (in / event)</span>
  <span class="swatch" style="background:#34c8b1"></span><span>two-way (inout)</span>
  <span class="swatch" style="background:#9966cc"></span><span>structural (for / if)</span>
  <span class="swatch" style="background:#7a7a7a"></span><span>invalid (orphan path)</span>
</div>
<div class="selection-hint hint-selected">
  Click the highlighted state path or component port to start moving that endpoint. ESC / background click to deselect.
</div>
<div class="selection-hint hint-moving-state">
  Click a state path to move this endpoint there. ESC / background click to cancel.
</div>
<div class="selection-hint hint-moving-dom">
  Click a highlighted component to move this endpoint there. ESC / background click to cancel.
</div>
<div class="controls">
  <button class="fit-btn" type="button" title="Fit graph to view (or double-click)">Fit</button>
</div>
`;

const ZOOM_FACTOR = 1.15;
const MIN_VIEW_W = 80;
const MAX_VIEW_W = 20000;

// CSS.escape with a fallback for environments that lack it (e.g. happy-dom).
function cssEscape(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/['"\\]/g, ch => `\\${ch}`);
}

class PveGraph extends HTMLElement {
  constructor() {
    super();
    this._source = '';
    this._graph = null;
    this._naturalViewBox = null;
    this._view = null;
    this._panning = false;
    this._panStart = null;
    this._didDrag = false;
    this._wireDrag = null; // create drag only
    this._ghostPath = null;
    this._selection = null; // { type: 'wire', wireIndex: number }
    this._escHandler = null;
    this._handlersInstalled = false;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = TEMPLATE;

    if (Object.prototype.hasOwnProperty.call(this, 'source')) {
      const pending = this.source;
      delete this.source;
      this.source = pending;
    }
  }

  disconnectedCallback() {
    if (this._escHandler) {
      window.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  }

  set source(v) {
    const next = v == null ? '' : String(v);
    if (next === this._source) return;
    this._source = next;
    this._render();
  }
  get source() { return this._source; }

  connectedCallback() {
    if (!this._handlersInstalled) {
      this._installHandlers();
      this._handlersInstalled = true;
    }
    if (this._source) this._render();
  }

  _installHandlers() {
    const svg = this.shadowRoot.querySelector('svg');
    const fitBtn = this.shadowRoot.querySelector('.fit-btn');

    svg.addEventListener('wheel', (e) => {
      if (!this._view) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      this._zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this._view) return;
      this._didDrag = false;

      // While in MOVING_STATE / MOVING_DOM the pointer should NOT
      // engage panning; clicks finalize or cancel the move.
      if (this._isMovingMode()) return;

      // Create-wire drag still uses pointer drag because it needs a
      // ghost wire to indicate the prospective endpoint. When the
      // press starts on a state-port-row that ALREADY belongs to the
      // selected wire, however, the click handler (not the drag)
      // should run so we can transition into MOVING_STATE.
      const portRow = e.target.closest('.state-port-row');
      if (portRow) {
        const movingWire = this._selectedWire();
        const isOwnEndpoint = movingWire
          && portRow.getAttribute('data-state-path') === movingWire.from.path
          && portRow.getAttribute('data-state-id') === movingWire.from.stateId;
        if (!isOwnEndpoint) {
          // Use the port-row's stored absolute coordinates instead of
          // recomputing via getCTM — the latter occasionally produced
          // origins that drifted from the actual port location.
          const px = parseFloat(portRow.getAttribute('data-port-x'));
          const py = parseFloat(portRow.getAttribute('data-port-y'));
          this._beginWireDrag(svg, e, {
            type: 'create',
            stateId: portRow.getAttribute('data-state-id'),
            path: portRow.getAttribute('data-state-path'),
            origin: Number.isFinite(px) && Number.isFinite(py)
              ? { x: px, y: py }
              : null,
          });
          return;
        }
        // Fall through so click handler can transition to MOVING_STATE.
      }

      // Don't engage panning when starting on a clickable element so
      // its click handler fires cleanly afterwards.
      if (e.target.closest && (
        e.target.closest('.wire-group.deletable') ||
        e.target.closest('.comp-port-row') ||
        e.target.closest('.state-port-row')
      )) return;

      this._panning = true;
      this.classList.add('panning');
      try { svg.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      this._panStart = {
        x: e.clientX,
        y: e.clientY,
        vx: this._view.x,
        vy: this._view.y,
      };
    });
    svg.addEventListener('pointermove', (e) => {
      if (this._wireDrag) {
        this._updateWireDrag(svg, e);
        return;
      }
      if (this._isMovingMode()) {
        this._updateMovingGhost(svg, e);
        return;
      }
      if (!this._panning) return;
      const dxPx = e.clientX - this._panStart.x;
      const dyPx = e.clientY - this._panStart.y;
      if (Math.abs(dxPx) > 3 || Math.abs(dyPx) > 3) this._didDrag = true;
      const rect = svg.getBoundingClientRect();
      const dx = dxPx / rect.width * this._view.w;
      const dy = dyPx / rect.height * this._view.h;
      this._view.x = this._panStart.vx - dx;
      this._view.y = this._panStart.vy - dy;
      this._applyView();
    });
    const stopPan = (e) => {
      if (this._wireDrag) {
        this._endWireDrag(svg, e);
        return;
      }
      if (!this._panning) return;
      this._panning = false;
      this.classList.remove('panning');
      try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };
    svg.addEventListener('pointerup', stopPan);
    svg.addEventListener('pointercancel', stopPan);

    svg.addEventListener('click', (e) => {
      if (this._didDrag) return;
      this._handleClick(e);
    });

    // ESC key:
    //   - In MOVING mode: cancel back to wire-selected.
    //   - In wire-selected: deselect (back to NORMAL).
    this._escHandler = (e) => {
      if (e.key !== 'Escape') return;
      const sel = this._selection;
      if (!sel) return;
      if (sel.type === 'moving-state' || sel.type === 'moving-dom') {
        this._setSelection({ type: 'wire-selected', wireIndex: sel.wireIndex });
      } else {
        this._setSelection(null);
      }
    };
    window.addEventListener('keydown', this._escHandler);

    svg.addEventListener('dblclick', () => this._fit());
    fitBtn.addEventListener('click', () => this._fit());
  }

  _handleClick(e) {
    const sel = this._selection;

    // Filter chip and X icon always work in NORMAL/SELECTED, never in
    // MOVING modes (during a move, those clicks are interpreted as
    // "click outside a valid target → cancel").
    if (!this._isMovingMode()) {
      const chip = e.target.closest('.filter-chip.editable');
      if (chip) {
        const cidx = parseInt(chip.getAttribute('data-wire-index'), 10);
        if (Number.isNaN(cidx)) return;
        const wire = this._graph && this._graph.wires[cidx];
        if (!wire || !wire.sourceRange || !wire.sourceRange.filterRange) return;
        this.dispatchEvent(new CustomEvent('filter-edit', {
          detail: { range: wire.sourceRange.filterRange, wire },
          bubbles: true, composed: true,
        }));
        return;
      }
      const icon = e.target.closest('.wire-delete-icon');
      if (icon) {
        const group = icon.closest('.wire-group.deletable');
        if (!group) return;
        const idx = parseInt(group.getAttribute('data-wire-index'), 10);
        const wire = this._graph && this._graph.wires[idx];
        if (!wire || !wire.sourceRange) return;
        if (sel && sel.wireIndex === idx) this._setSelection(null);
        this.dispatchEvent(new CustomEvent('wire-delete', {
          detail: { range: wire.sourceRange, wire },
          bubbles: true, composed: true,
        }));
        return;
      }
    }

    // ─── MOVING_STATE: looking for a state-port-row to land on ───
    if (sel && sel.type === 'moving-state') {
      const moving = this._graph && this._graph.wires[sel.wireIndex];
      if (!moving) { this._setSelection(null); return; }
      const stateRow = e.target.closest('.state-port-row');
      if (stateRow) {
        const newPath = stateRow.getAttribute('data-state-path');
        if (newPath && newPath !== moving.from.path) {
          this.dispatchEvent(new CustomEvent('wire-rewire', {
            detail: { wire: moving, newPath, range: moving.sourceRange.pathRange },
            bubbles: true, composed: true,
          }));
          this._setSelection(null);
        } else {
          // Same path → cancel back to selected.
          this._setSelection({ type: 'wire-selected', wireIndex: sel.wireIndex });
        }
        return;
      }
      // Anywhere else → cancel back to selected.
      this._setSelection({ type: 'wire-selected', wireIndex: sel.wireIndex });
      return;
    }

    // ─── MOVING_DOM: clicking inside a receivable comp frame finalizes ───
    if (sel && sel.type === 'moving-dom') {
      const moving = this._graph && this._graph.wires[sel.wireIndex];
      if (!moving) { this._setSelection(null); return; }
      const compEl = e.target.closest('.comp-node.receivable');
      if (compEl) {
        const compId = compEl.getAttribute('data-comp-id');
        const comp = this._graph.components.find(c => c.id === compId);
        if (!comp) {
          this._setSelection({ type: 'wire-selected', wireIndex: sel.wireIndex });
          return;
        }
        // Pre-fill the prompt with the clicked port's property name
        // when the click happened on a specific port row.
        const portRow = e.target.closest('.comp-port-row');
        const suggestedProperty = (portRow && !portRow.classList.contains('mustache'))
          ? portRow.getAttribute('data-port-property')
          : '';
        // Sample sourceRange + existing properties (so the state
        // handler can decide append vs replace without re-querying).
        // tagSourceRange enables inserting a brand-new data-wcs
        // attribute on a target that has none yet.
        const compWires = this._graph.wires.filter(w =>
          w.to.componentId === compId && w.sourceRange
        );
        const sample = compWires[0] ? compWires[0].sourceRange : null;
        const existingProps = compWires.map(w => ({
          property: w.to.property,
          targetSourceRange: w.sourceRange,
        }));
        this.dispatchEvent(new CustomEvent('wire-move-dom-to-comp', {
          detail: {
            movingWire: moving,
            compTag: comp.tag,
            sampleSourceRange: sample,
            tagSourceRange: comp.tagSourceRange || null,
            existingProps,
            suggestedProperty,
          },
          bubbles: true, composed: true,
        }));
        this._setSelection(null);
        return;
      }
      // Anywhere outside a receivable comp → cancel back to selected.
      this._setSelection({ type: 'wire-selected', wireIndex: sel.wireIndex });
      return;
    }

    // ─── SELECTED: click own endpoint → enter MOVING_*; other clicks deselect/switch ───
    if (sel && sel.type === 'wire-selected') {
      const moving = this._graph && this._graph.wires[sel.wireIndex];
      if (!moving) { this._setSelection(null); return; }

      const stateRow = e.target.closest('.state-port-row');
      if (stateRow) {
        const path = stateRow.getAttribute('data-state-path');
        const stateId = stateRow.getAttribute('data-state-id');
        const isOwn = path === moving.from.path && stateId === moving.from.stateId;
        if (isOwn && moving.sourceRange && moving.sourceRange.pathRange) {
          this._setSelection({ type: 'moving-state', wireIndex: sel.wireIndex });
          return;
        }
        // Click on a different state path while selected → just deselect.
        this._setSelection(null);
        return;
      }

      const compPortRow = e.target.closest('.comp-port-row');
      if (compPortRow) {
        const compId = compPortRow.getAttribute('data-comp-id');
        const property = compPortRow.getAttribute('data-port-property');
        const isOwn = compId === moving.to.componentId && property === moving.to.property;
        if (isOwn && moving.sourceRange && moving.sourceRange.pathRange) {
          this._setSelection({ type: 'moving-dom', wireIndex: sel.wireIndex });
          return;
        }
        this._setSelection(null);
        return;
      }

      const wireGroup = e.target.closest('.wire-group');
      if (wireGroup) {
        const idx = parseInt(wireGroup.getAttribute('data-wire-index'), 10);
        if (idx === sel.wireIndex) {
          this._setSelection(null);
          return;
        }
        const wire = this._graph && this._graph.wires[idx];
        if (wire && wire.sourceRange) {
          this._setSelection({ type: 'wire-selected', wireIndex: idx });
        }
        return;
      }

      // Click on background → deselect.
      this._setSelection(null);
      return;
    }

    // ─── NORMAL: click on wire → select ───
    const wireGroup = e.target.closest('.wire-group');
    if (wireGroup) {
      const idx = parseInt(wireGroup.getAttribute('data-wire-index'), 10);
      if (!Number.isNaN(idx)) {
        const wire = this._graph && this._graph.wires[idx];
        if (wire && wire.sourceRange) {
          this._setSelection({ type: 'wire-selected', wireIndex: idx });
        }
      }
      return;
    }
  }

  _isMovingMode() {
    return this._selection
      && (this._selection.type === 'moving-state' || this._selection.type === 'moving-dom');
  }

  _selectedWire() {
    if (!this._selection || this._selection.type !== 'wire-selected') return null;
    return this._graph && this._graph.wires[this._selection.wireIndex];
  }

  _setSelection(sel) {
    const prev = this._selection;
    const wasMoving =
      prev && (prev.type === 'moving-state' || prev.type === 'moving-dom');
    const willMove =
      sel && (sel.type === 'moving-state' || sel.type === 'moving-dom');
    this._selection = sel;
    const root = this.shadowRoot;
    const svg = root.querySelector('svg');

    // Clear all visual selection state.
    root.querySelectorAll('.wire-group.selected').forEach(g => g.classList.remove('selected'));
    root.querySelectorAll('.endpoint-selected').forEach(g => g.classList.remove('endpoint-selected'));
    this.classList.remove('has-selection');
    this.classList.remove('moving-state');
    this.classList.remove('moving-dom');

    // Apply new selection visuals.
    if (sel) {
      const wire = this._graph && this._graph.wires[sel.wireIndex];
      if (wire) {
        const wg = root.querySelector(`.wire-group[data-wire-index="${sel.wireIndex}"]`);
        if (wg) wg.classList.add('selected');

        // Highlight both endpoints (the wire's own state path and comp port).
        const sr = root.querySelector(
          `.state-port-row[data-state-id="${cssEscape(wire.from.stateId)}"][data-state-path="${cssEscape(wire.from.path)}"]`
        );
        if (sr) sr.classList.add('endpoint-selected');
        const cr = root.querySelector(
          `.comp-port-row[data-comp-id="${cssEscape(wire.to.componentId)}"][data-port-property="${cssEscape(wire.to.property)}"]`
        );
        if (cr) cr.classList.add('endpoint-selected');

        // Notify the host so the textarea can highlight the matching
        // DOM source range. Fired only when entering wire-selected
        // (not while the wire is in MOVING modes — selection of the
        // textarea would interfere with reading the marching wire).
        if (sel.type === 'wire-selected' && this._graph) {
          const comp = this._graph.components.find(c => c.id === wire.to.componentId);
          if (comp && comp.tagSourceRange) {
            this.dispatchEvent(new CustomEvent('wire-target-located', {
              detail: {
                tagStart: comp.tagSourceRange.tagStart,
                tagEnd: comp.tagSourceRange.tagEnd,
              },
              bubbles: true, composed: true,
            }));
          }
        }
      }
      if (sel.type === 'wire-selected') this.classList.add('has-selection');
      if (sel.type === 'moving-state') this.classList.add('moving-state');
      if (sel.type === 'moving-dom') this.classList.add('moving-dom');
    }

    // Manage the moving-mode ghost wire lifecycle.
    if (willMove && !wasMoving) {
      this._enterMovingMode(svg, sel);
    } else if (wasMoving && !willMove) {
      this._exitMovingMode();
    } else if (willMove && wasMoving && prev.type !== sel.type) {
      // Switching directly between moving-state and moving-dom (rare).
      this._exitMovingMode();
      this._enterMovingMode(svg, sel);
    }
  }

  _enterMovingMode(svg, sel) {
    const wireGroup = this.shadowRoot.querySelector(
      `.wire-group[data-wire-index="${sel.wireIndex}"]`
    );
    if (!wireGroup) return;
    const attr = sel.type === 'moving-state'
      ? wireGroup.getAttribute('data-comp-end')   // moving state-end → DOM-end is fixed
      : wireGroup.getAttribute('data-state-end'); // moving DOM-end   → state-end is fixed
    if (!attr) return;
    const [fx, fy] = attr.split(',').map(parseFloat);
    this._movingFixedEnd = { x: fx, y: fy };
    // Spawn ghost as a zero-length placeholder; pointermove will size it.
    this._spawnGhostWire(svg, this._movingFixedEnd, this._movingFixedEnd);

    // In MOVING_DOM, mark every comp-node that is a valid drop target.
    // Receivable = has a tagSourceRange (so we can splice / insert)
    // AND is not the moving wire's own component (PoC keeps same-comp
    // property renames out of scope).
    if (sel.type === 'moving-dom' && this._graph) {
      const moving = this._graph.wires[sel.wireIndex];
      if (moving) {
        for (const c of this._graph.components) {
          if (c.id === moving.to.componentId) continue;
          if (!c.tagSourceRange) continue;
          const el = this.shadowRoot.querySelector(
            `[data-comp-id="${cssEscape(c.id)}"]`
          );
          if (el) el.classList.add('receivable');
        }
      }
    }
  }

  _exitMovingMode() {
    this._removeGhostWire();
    this._movingFixedEnd = null;
    this.shadowRoot
      .querySelectorAll('.receivable')
      .forEach(el => el.classList.remove('receivable'));
  }

  _updateMovingGhost(svg, e) {
    if (!this._movingFixedEnd || !this._selection) return;
    const cur = this._clientToSvg(svg, e.clientX, e.clientY);
    if (this._selection.type === 'moving-state') {
      // State-end follows the cursor; ghost goes cursor → fixed DOM-end.
      this._updateGhostWire(cur, this._movingFixedEnd);
    } else {
      // DOM-end follows the cursor; ghost goes fixed state-end → cursor.
      this._updateGhostWire(this._movingFixedEnd, cur);
    }
  }

  _zoomAt(clientX, clientY, factor) {
    const svg = this.shadowRoot.querySelector('svg');
    const rect = svg.getBoundingClientRect();
    const mx = (clientX - rect.left) / rect.width;
    const my = (clientY - rect.top) / rect.height;
    let newW = this._view.w * factor;
    let newH = this._view.h * factor;
    if (newW < MIN_VIEW_W) {
      const scale = MIN_VIEW_W / newW;
      newW *= scale;
      newH *= scale;
    } else if (newW > MAX_VIEW_W) {
      const scale = MAX_VIEW_W / newW;
      newW *= scale;
      newH *= scale;
    }
    this._view.x += (this._view.w - newW) * mx;
    this._view.y += (this._view.h - newH) * my;
    this._view.w = newW;
    this._view.h = newH;
    this._applyView();
  }

  _applyView() {
    const svg = this.shadowRoot.querySelector('svg');
    svg.setAttribute('viewBox', `${this._view.x} ${this._view.y} ${this._view.w} ${this._view.h}`);
  }

  _clientToSvg(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  _beginWireDrag(svg, e, info) {
    let origin;
    if (info.type === 'rewire') {
      // Rewire's ghost originates from the wire's UNCHANGED component
      // endpoint (rewire keeps that side fixed). Pull pre-stored
      // coordinates from the wire-group element.
      const wireGroup = svg.querySelector(
        `.wire-group[data-wire-index="${info.wireIndex}"]`
      );
      const compEndAttr = wireGroup && wireGroup.getAttribute('data-comp-end');
      if (compEndAttr) {
        const [cx, cy] = compEndAttr.split(',').map(parseFloat);
        origin = { x: cx, y: cy };
      } else {
        origin = this._clientToSvg(svg, e.clientX, e.clientY);
      }
    } else if (info.origin) {
      // Caller already supplied absolute SVG-viewBox coordinates.
      origin = info.origin;
    } else {
      origin = this._clientToSvg(svg, e.clientX, e.clientY);
    }
    this._wireDrag = { ...info, origin };
    this.classList.add('wire-dragging');
    try { svg.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    e.preventDefault();
    const cur = this._clientToSvg(svg, e.clientX, e.clientY);
    this._spawnGhostWire(svg, origin, cur);
  }

  _updateWireDrag(svg, e) {
    if (!this._wireDrag) return;
    const cur = this._clientToSvg(svg, e.clientX, e.clientY);
    this._updateGhostWire(this._wireDrag.origin, cur);
    const dropTarget = this._dropTargetAt(e.clientX, e.clientY, this._wireDrag.type);
    this._setDropHover(dropTarget);
  }

  _endWireDrag(svg, e) {
    const drag = this._wireDrag;
    if (!drag) return;

    // Detect drop target FIRST while drag info is still available.
    const dropTarget = this._dropTargetAt(e.clientX, e.clientY, drag.type);

    // Then clean up state.
    this._wireDrag = null;
    this.classList.remove('wire-dragging');
    this._removeGhostWire();
    this._setDropHover(null);
    try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }

    if (!dropTarget) return;

    if (drag.type === 'rewire') {
      const port = dropTarget.pathPort;
      if (!port) return;
      const wire = this._graph && this._graph.wires[drag.wireIndex];
      if (!wire || !wire.sourceRange || !wire.sourceRange.pathRange) return;
      const newPath = port.getAttribute('data-state-path');
      if (newPath === wire.from.path) return;
      this.dispatchEvent(new CustomEvent('wire-rewire', {
        detail: { wire, newPath, range: wire.sourceRange.pathRange },
        bubbles: true,
        composed: true,
      }));
    } else if (drag.type === 'create') {
      const compEl = dropTarget.compEl;
      if (!compEl) return;
      const compId = compEl.getAttribute('data-comp-id');
      const comp = this._graph && this._graph.components.find(c => c.id === compId);
      if (!comp) return;
      const sample = (this._graph.wires.find(w =>
        w.to.componentId === comp.id && w.sourceRange
      ) || {}).sourceRange || null;
      this.dispatchEvent(new CustomEvent('wire-create', {
        detail: {
          sourcePath: drag.path,
          sourceStateId: drag.stateId,
          compTag: comp.tag,
          compStructural: !!comp.structural,
          sampleSourceRange: sample,
          tagSourceRange: comp.tagSourceRange || null,
        },
        bubbles: true,
        composed: true,
      }));
    }
  }

  _dropTargetAt(clientX, clientY, dragType) {
    const root = this.shadowRoot;
    if (!root || !root.elementFromPoint) return null;
    const el = root.elementFromPoint(clientX, clientY);
    if (!el) return null;
    if (dragType === 'rewire') {
      const port = el.closest('.state-port-row');
      if (port) return { pathPort: port };
      return null;
    }
    if (dragType === 'create') {
      const compEl = el.closest('[data-comp-id]');
      if (compEl) return { compEl };
      return null;
    }
    return null;
  }

  _setDropHover(dropTarget) {
    const root = this.shadowRoot;
    root.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
    if (!dropTarget) return;
    if (dropTarget.pathPort) dropTarget.pathPort.classList.add('drop-hover');
    if (dropTarget.compEl) dropTarget.compEl.classList.add('drop-hover');
  }

  _spawnGhostWire(svg, from, to) {
    if (this._ghostPath) this._ghostPath.remove();
    const ns = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('class', 'ghost-wire');
    path.setAttribute('fill', 'none');
    svg.appendChild(path);
    this._ghostPath = path;
    this._updateGhostWire(from, to);
  }

  _updateGhostWire(from, to) {
    if (!this._ghostPath) return;
    const dx = Math.max(40, Math.abs(to.x - from.x) * 0.45);
    const d = `M ${from.x} ${from.y} C ${from.x + dx} ${from.y} ${to.x - dx} ${to.y} ${to.x} ${to.y}`;
    this._ghostPath.setAttribute('d', d);
  }

  _removeGhostWire() {
    if (this._ghostPath) {
      this._ghostPath.remove();
      this._ghostPath = null;
    }
  }

  _fit() {
    if (!this._naturalViewBox) return;
    this._view = { ...this._naturalViewBox };
    this._applyView();
  }

  _render() {
    const svg = this.shadowRoot.querySelector('svg');
    const hadView = !!this._view;
    try {
      const graph = parseHtml(this._source);
      this._graph = graph;
      this._naturalViewBox = renderGraph(graph, svg);
      // Wire indices change between parses, so clear any selection.
      // The DOM was rebuilt from scratch by renderGraph — class state is gone.
      this._selection = null;
      this.classList.remove('has-selection');
      if (!hadView) {
        this._view = { ...this._naturalViewBox };
      }
      this._applyView();
    } catch (e) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.setAttribute('viewBox', '0 0 600 60');
      this._view = { x: 0, y: 0, w: 600, h: 60 };
      this._naturalViewBox = { ...this._view };
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', '20');
      t.setAttribute('y', '32');
      t.setAttribute('class', 'error');
      t.textContent = `Parse error: ${e instanceof Error ? e.message : String(e)}`;
      svg.appendChild(t);
    }
  }
}

if (!customElements.get('pve-graph')) {
  customElements.define('pve-graph', PveGraph);
}
