// みどり市 共通部品 <garden-card> — a garden: name, address, its 利用率 and its areas as <area-block>s. It can be folded;
// whether it is folded is the card's own business (a private key), not the page's data.
// A developers' part: a class with `bind-component`.
//
//   <garden-card data-wcs="state: garden; state.view: view"></garden-card>
//
// Given (mounted):  the garden (`state: …`) — id, name, address, areas[]
//                   view (`state.view: …`) — handed on to every area and tile
// Gives back:       nothing of its own (the tiles write view.selectedId)
// Exported getters: usage (%), inUse, total, freeCount, matchCount, counts
import { countStatuses, matchesFilter, usagePercent } from "./lib/counts.js";

const TEMPLATE = `
<style>
  :host { display: block; }
  article { border: 1px solid var(--midori-line, #c9ced6); border-radius: 8px; background: var(--midori-surface-2, #f7f8fa);
    padding: var(--midori-pad, 0.6em) calc(var(--midori-pad, 0.6em) * 1.4); }
  header { display: flex; align-items: center; gap: 0.8em; flex-wrap: wrap; }
  h3 { margin: 0; font-size: 1.1em; }
  .addr { color: var(--midori-muted, #4a5260); font-size: 0.9em; }
  .usage { margin-left: auto; font-variant-numeric: tabular-nums; }
  .bar { display: inline-block; width: 6em; height: 0.55em; border-radius: 99px; background: var(--midori-line, #c9ced6);
    vertical-align: middle; overflow: hidden; margin-right: 0.4em; }
  .bar > span { display: block; height: 100%; background: var(--midori-accent, #2f62a3); }
  button.fold { font: inherit; border: 1px solid var(--midori-line, #c9ced6); background: var(--midori-surface, #fff);
    color: var(--midori-fg, #1b1f24); border-radius: 4px; padding: 0.15em 0.6em; cursor: pointer; }
  button.fold:focus-visible { outline: 3px solid var(--midori-focus, #1a73e8); outline-offset: 1px; }
  .areas { display: grid; gap: var(--midori-gap, 0.6em); margin-top: 0.6em; }
  .areas[hidden] { display: none; }
  /* A nested part that has not arrived: the page's tokens.css cannot reach into this shadow root. */
  area-block:not(:defined) { display: block; min-height: 7em; border: 1px dashed var(--midori-line, #c9ced6); border-radius: 6px; }
  area-block:not(:defined)::before { content: "読み込み中…"; display: block; padding: 0.8em; color: var(--midori-muted, #4a5260); }
</style>
<wcs-state bind-component="state"></wcs-state>
<article data-wcs="attr.aria-label: name">
  <header>
    <button type="button" class="fold" data-wcs="onclick: toggle; attr.aria-expanded: expanded; attr.aria-controls: areasId; textContent: foldLabel"></button>
    <h3 data-wcs="textContent: name"></h3>
    <span class="addr" data-wcs="textContent: address"></span>
    <span class="usage">
      <span class="bar" aria-hidden="true"><span data-wcs="style.width: usage|unit(%)"></span></span>
      利用率 <strong class="pct" data-wcs="textContent: usage"></strong>%
      （<span class="in-use" data-wcs="textContent: inUse"></span> / <span data-wcs="textContent: total"></span>）
    </span>
  </header>
  <div class="areas" data-wcs="hidden: folded; attr.id: areasId">
    <template data-wcs="for: areas">
      <area-block data-wcs="state: .; state.view: view"></area-block>
    </template>
  </div>
</article>
`;

export default class GardenCard extends HTMLElement {
  state = {
    folded: false, // private: per card element, never written to the page's data
    get counts() { return countStatuses(this.$getAll("areas.*.plots.*.status", [])); },
    get inUse() { return this.counts.inUse; },
    get total() { return this.counts.total; },
    get freeCount() { return this.counts.free; },
    get usage() { return usagePercent(this.counts.inUse, this.counts.total); },
    get matchCount() {
      const f = this["view.filter"];
      return this.$getAll("areas.*.plots.*.status", []).filter((s) => matchesFilter(s, f)).length;
    },
    get expanded() { return String(!this.folded); },
    get foldLabel() { return this.folded ? "▶ 開く" : "▼ たたむ"; },
    get areasId() { return `garden-${this.id}-areas`; },
    toggle() { this.folded = !this.folded; },
  };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    if (this.shadowRoot.childNodes.length === 0) this.shadowRoot.innerHTML = TEMPLATE;
  }
}
