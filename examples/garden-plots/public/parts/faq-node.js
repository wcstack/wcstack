// みどり市 共通部品 <faq-node> — a node of a tree whose depth nobody knows: a title, the number of questions in it
// and below it, open or closed, its questions, and its children — each of them a <faq-node>.
// A developers' part: a class with `bind-component`; it mounts itself on each child row.
//
//   <faq-node data-wcs="state: .; state.q#ro: faqQuery"></faq-node>
//
// Given (mounted):  the node (`state: …`) — id, title, questions[{ q, a }], children[]
//                   q (`state.q: …`, read-only) — the search text; handed on to every child
// Gives back:       nothing (open / closed is the node's own business — a private key)
// Exported getters: total (questions here and below), matchCount, hasMatch
import { questionMatches, textMatches } from "./lib/faq.js";

const TEMPLATE = `
<style>
  :host { display: block; }
  .node { border-left: 2px solid var(--midori-line, #c9ced6); padding-left: 0.8em; margin: 0.25em 0; }
  .dim > .head { opacity: 0.4; }
  .head { display: flex; align-items: center; gap: 0.5em; }
  button { font: inherit; display: inline-flex; align-items: center; gap: 0.5em; padding: 0.2em 0.4em; border: 0; border-radius: 4px;
    background: transparent; color: var(--midori-fg, #1b1f24); cursor: pointer; text-align: left; }
  button:focus-visible { outline: 3px solid var(--midori-focus, #1a73e8); }
  .chev { display: inline-block; width: 1em; transition: transform 0.15s; }
  [aria-expanded="true"] .chev { transform: rotate(90deg); }
  .title { font-weight: 600; }
  .count { font-size: 0.8em; padding: 0 0.5em; border-radius: 99px; background: var(--midori-surface-2, #f1f3f5);
    color: var(--midori-muted, #4a5260); font-variant-numeric: tabular-nums; }
  .body[hidden] { display: none; }
  ul.qs { margin: 0.2em 0 0.4em 1.6em; padding: 0; }
  ul.qs li { margin: 0.25em 0; }
  li.hit { background: var(--midori-hit, #fff3b0); color: var(--midori-hit-fg, inherit); border-radius: 3px; }
  faq-node:not(:defined) { display: block; min-height: 1.6em; color: var(--midori-muted, #4a5260); }
  .a { display: block; color: var(--midori-muted, #4a5260); font-size: 0.9em; }
</style>
<wcs-state bind-component="state"></wcs-state>
<div class="node" data-wcs="class.dim: dim; attr.data-node-id: id">
  <div class="head">
    <button type="button" data-wcs="onclick: toggle; attr.aria-expanded: ariaExpanded; attr.aria-controls: bodyId">
      <span class="chev" aria-hidden="true">▶</span>
      <span class="title" data-wcs="textContent: title"></span>
      <span class="count" data-wcs="textContent: countLabel; attr.aria-label: countAria"></span>
    </button>
  </div>
  <div class="body" data-wcs="hidden: expanded|not; attr.id: bodyId">
    <ul class="qs">
      <template data-wcs="for: questions">
        <li data-wcs="class.hit: .hit"><span class="q" data-wcs="textContent: .q"></span><span class="a" data-wcs="textContent: .a"></span></li>
      </template>
    </ul>
    <template data-wcs="for: children">
      <faq-node data-wcs="state: .; state.q#ro: q"></faq-node>
    </template>
  </div>
</div>
`;

export default class FaqNode extends HTMLElement {
  state = {
    open: false, // private: per node element
    q: "",       // private default; an explicit `state.q:` mount wins over it
    get searching() { return Boolean(String(this.q ?? "").trim()); },
    get titleHit() { return textMatches(this.title, this.q); },
    get "questions.*.hit"() { return questionMatches(this["."], this.q); },
    get total() {
      return this.questions.length + this.$getAll("children.*.total", []).reduce((a, b) => a + (b ?? 0), 0);
    },
    get matchCount() {
      const own = this.titleHit ? this.questions.length : this.$getAll("questions.*.hit", []).filter(Boolean).length;
      return own + this.$getAll("children.*.matchCount", []).reduce((a, b) => a + (b ?? 0), 0);
    },
    get hasMatch() { return this.titleHit || this.matchCount > 0; },
    get expanded() { return this.searching ? this.hasMatch : this.open; },
    get dim() { return this.searching && !this.hasMatch; },
    get ariaExpanded() { return String(this.expanded); },
    get bodyId() { return `faq-${this.id}`; },
    get countLabel() { return this.searching ? `${this.matchCount} / ${this.total}` : String(this.total); },
    get countAria() { return this.searching ? `${this.total} 問中 ${this.matchCount} 問が該当` : `${this.total} 問`; },
    toggle() { this.open = !this.expanded; },
  };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    if (this.shadowRoot.childNodes.length === 0) this.shadowRoot.innerHTML = TEMPLATE;
  }
}
