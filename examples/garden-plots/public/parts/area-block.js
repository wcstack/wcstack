// みどり市 共通部品 <area-block> — an area of a garden: its name, 空き 3 / 24, and its plots as <plot-tile>s.
// A developers' part: a class with `bind-component`.
//
//   <area-block data-wcs="state: area; state.view: view"></area-block>
//
// Given (mounted):  the area (`state: …`) — id, name, plots[]
//                   view (`state.view: …`) — handed on to every tile (see plot-tile.js)
// Gives back:       view.selectedId (arrow keys move the selection between the tiles of this area)
// Exported getters: freeCount, total, matchCount, counts
import { countStatuses, matchesFilter } from "./lib/counts.js";

const TEMPLATE = `
<style>
  :host { display: block; }
  section { border: 1px solid var(--midori-line, #c9ced6); border-radius: 6px; padding: var(--midori-pad, 0.6em);
    background: var(--midori-surface, #fff); }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5em; margin-bottom: 0.4em; }
  h4 { margin: 0; font-size: 0.95em; }
  .count { font-size: 0.85em; color: var(--midori-muted, #4a5260); font-variant-numeric: tabular-nums; }
  .match { margin-left: 0.6em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--midori-tile-w, 4.6em), 1fr)); gap: 0.25em;
    list-style: none; margin: 0; padding: 0; }
  /* A tile part that has not arrived holds its place (tokens.css cannot reach into this shadow root). */
  plot-tile:not(:defined) { display: block; height: var(--midori-tile-h, 3.4em); border-radius: 4px; background: var(--midori-surface-2, #f1f3f5); }
</style>
<wcs-state bind-component="state"></wcs-state>
<section data-wcs="attr.aria-label: name">
  <header>
    <h4 data-wcs="textContent: name"></h4>
    <span class="count">空き <span class="free" data-wcs="textContent: freeCount"></span> / <span class="total" data-wcs="textContent: total"></span><span class="match" data-wcs="hidden: filtered|not">該当 <span class="matched" data-wcs="textContent: matchCount"></span></span></span>
  </header>
  <div class="grid" role="group" data-wcs="attr.aria-label: name; onkeydown: move">
    <template data-wcs="for: plots">
      <plot-tile data-wcs="state: .; state.view: view; state.first#ro: .first"></plot-tile>
    </template>
  </div>
</section>
`;

const KEYS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: "up", ArrowDown: "down", Home: "home", End: "end" };

export default class AreaBlock extends HTMLElement {
  state = {
    get counts() { return countStatuses(this.$getAll("plots.*.status", [])); },
    get freeCount() { return this.counts.free; },
    get total() { return this.counts.total; },
    get filtered() { const f = this["view.filter"]; return Boolean(f) && f !== "all"; },
    get matchCount() {
      const f = this["view.filter"];
      return this.$getAll("plots.*.status", []).filter((s) => matchesFilter(s, f)).length;
    },
    // The Tab stop of an area: the first tile (the selected one takes a stop of its own, see plot-tile.js).
    get "plots.*.first"() { return this.$1 === 0; },
    /** Arrow keys: move the selection to the neighbouring tile and put the focus on it. */
    move(event) {
      const step = KEYS[event.key];
      if (step === undefined || !this["view.selectable"]) return;
      const tile = event.target.closest?.("plot-tile");
      if (!tile) return;
      const tiles = [...tile.parentElement.querySelectorAll(":scope > plot-tile")];
      const i = tiles.indexOf(tile);
      if (i < 0) return;
      let j = i;
      if (typeof step === "number") j = i + step;
      else if (step === "home") j = 0;
      else if (step === "end") j = tiles.length - 1;
      else {
        // Up / down: the tile in the same column of the previous / next row of the grid.
        const columns = getComputedStyle(tile.parentElement).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
        j = i + (step === "up" ? -columns : columns);
      }
      if (j < 0 || j >= tiles.length || j === i) return;
      event.preventDefault();
      this["view.selectedId"] = this.$resolve("plots.*.id", [j]);
      tiles[j].focus();
    },
  };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    if (this.shadowRoot.childNodes.length === 0) this.shadowRoot.innerHTML = TEMPLATE;
  }
}
