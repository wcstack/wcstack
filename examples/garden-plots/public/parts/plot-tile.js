// みどり市 共通部品 <plot-tile> — one plot: its number, a colour for its status, the tenant's family name, a look for
// "selected". A developers' part: a class with `bind-component`.
//
//   <plot-tile data-wcs="state: plot; state.view: view; state.first#ro: isFirst"></plot-tile>
//
// Given (mounted):  the plot itself (`state: …`) — id, no, status, tenant, since
//                   view   (`state.view: …`)  — { filter: "all"|status, selectedId, selectable } — shared by every tile
//                   first  (`state.first: …`, optional) — true for the tile that takes the Tab stop when none is selected
// Gives back:       view.selectedId (a click, Enter or Space selects the plot when view.selectable)
// Exported getters: selected, matches
import { familyName, matchesFilter, STATUS_LABEL } from "./lib/counts.js";

const TEMPLATE = `
<style>
  :host { display: block; }
  button {
    box-sizing: border-box; width: 100%; height: var(--midori-tile-h, 3.4em); padding: 0.2em 0.3em;
    display: grid; grid-template-rows: auto 1fr; align-items: start; text-align: left; gap: 0.1em;
    font: inherit; font-size: 0.78em; line-height: 1.25; cursor: pointer;
    border: 1px solid var(--tile-border); border-left: 0.45em solid var(--tile-accent); border-radius: 4px;
    background: var(--tile-bg); color: var(--tile-fg);
  }
  button:disabled { cursor: default; }
  button:focus-visible { outline: 3px solid var(--midori-focus, #1a73e8); outline-offset: 1px; }
  .s-free    { --tile-accent: var(--midori-free-accent, #2e8b47);    --tile-bg: var(--midori-free-tile, #f1faf3); }
  .s-used    { --tile-accent: var(--midori-used-accent, #2f62a3);    --tile-bg: var(--midori-used-tile, #f2f6fc); }
  .s-renewal { --tile-accent: var(--midori-renewal-accent, #c08a00); --tile-bg: var(--midori-renewal-tile, #fff9e8); }
  .s-paused  { --tile-accent: var(--midori-paused-accent, #7a7a7a);  --tile-bg: var(--midori-paused-tile, #f3f3f3); }
  button { --tile-border: var(--midori-line, #c9ced6); --tile-fg: var(--midori-fg, #1b1f24); }
  .selected { --tile-border: var(--midori-focus, #1a73e8); box-shadow: 0 0 0 2px var(--midori-focus, #1a73e8) inset; font-weight: 700; }
  .dim { opacity: 0.28; }
  .no { font-weight: 700; letter-spacing: 0.02em; }
  .who { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--midori-muted, #4a5260); }
</style>
<wcs-state bind-component="state"></wcs-state>
<button type="button" part="tile"
  data-wcs="className: tileClass; attr.tabindex: tabStop; attr.aria-pressed: pressed; attr.aria-label: label;
            attr.data-plot-id: id; attr.data-status: status; disabled: locked; onclick: select">
  <span class="no" data-wcs="textContent: no"></span>
  <span class="who" data-wcs="textContent: family"></span>
</button>
`;

export default class PlotTile extends HTMLElement {
  // Methods and getters only: the plot's keys come from the mount (an own default would hide them — rule R1).
  state = {
    // `first` is not a key of a plot: this default is private, and an explicit `state.first:` mount wins over it.
    first: false,
    get selected() { return this.$eqPath("view.selectedId", "id"); },
    get matches() { return matchesFilter(this.status, this["view.filter"]); },
    get family() { return familyName(this["tenant.name"]); },
    get locked() { return !this["view.selectable"]; },
    get tileClass() {
      return `s-${this.status}${this.selected ? " selected" : ""}${this.matches ? "" : " dim"}`;
    },
    get tabStop() { return this.locked ? null : (this.selected || this.first ? "0" : "-1"); },
    get pressed() { return this.locked ? null : String(this.selected); },
    get label() {
      const who = this.family ? `、${this.family}` : "";
      return `${this.no} ${STATUS_LABEL[this.status] ?? this.status}${who}`;
    },
    select() {
      if (!this["view.selectable"]) return;
      this["view.selectedId"] = this.id;
    },
  };

  constructor() {
    super();
    this.attachShadow({ mode: "open", delegatesFocus: true });
  }

  connectedCallback() {
    // Build the shadow here, not in the constructor (skill state-binding.md §14).
    if (this.shadowRoot.childNodes.length === 0) this.shadowRoot.innerHTML = TEMPLATE;
  }
}
