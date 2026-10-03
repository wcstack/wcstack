/**
 * Server-side rendering with @wcstack/server (README "Server-Side Rendering"), for
 * `<wcs-state enable-ssr>` roots.
 *
 * Server (`<html data-wcs-server>`): the page renders as usual; the snapshot builder
 * (`Symbol.for("wcstack.ssr.snapshotBuilder")`, called by the server before it serializes)
 * then makes the DOM adoptable:
 * - every view's rows / branch move right after its anchor, between `<!--wcs-[-->` and
 *   `<!--wcs-]-->`, each row opened by `<!--wcs-|-->` (a branch region carries its index,
 *   `<!--wcs-[:i-->`, and follows the chain's last anchor so the chain's templates stay adjacent);
 * - a page-level anchor becomes `<!--wcs-p:ID-->`, its template kept in `<wcs-ssr>` as
 *   `<template id=ID>`; a page-level text binding (a mustache, a comment binding) is wrapped in
 *   `<!--wcs-t:EXPR-->…<!--wcs-/t-->` (the client puts a comment binding back);
 * - adjacent text nodes are separated (`<!--wcs-s-->`) and empty ones kept (`<!--wcs-e-->`), so
 *   parsing the HTML gives back the rows' exact structure;
 * - `<wcs-ssr version>` before the element holds the state's data (JSON) and the templates.
 *
 * Client: before the page is bound, the texts and templates are restored and the regions read where
 * they are (their marks go; the page's walk passes their nodes by); each block the engine builds
 * takes its region's next row instead of a clone (a row's nested regions wait for its nested views
 * in turn). The server's nodes never leave the page — no custom element in a row or a branch is
 * disconnected — and get their bindings; a view's anchors move after its rows instead. A row that
 * does not fit its plan is built anew in its place, and the rows no view took go once the page is
 * bound. `$connectedCallback` does not run (the server ran it).
 *
 * A snapshot of another major.minor is discarded, and the page renders on the client as it would
 * without a server: the state comes from its own source, `$connectedCallback` runs, and the server's
 * rows and marks give way to the templates they came from — those of @wcstack/server 3.x's output
 * too (`legacy`).
 *
 * Not carried over from @wcstack/state 3.3 (approved): the inline snapshot for servers without
 * the builder protocol, and the property value table (every binding is applied on adoption).
 */
import type { Engine } from "../engine";
import { ForView, type Block, type IfView, type RowPlan, type Spec } from "../dom/view";
import { config } from "../config";
import { hooks } from "../hooks";

import { VERSION } from "../version";
import { isOuter, setsContent, templateContent, walked } from "../dom/plan";
import { majorMinor } from "./element";
import { parseBindTextsForElement } from "../parser/parseBindTextsForElement";
/** The snapshot element's tag (`config.tagNames.ssr`, `wcs-ssr` by default). */
const tag = (): string => config.tagNames.ssr;
const BUILDER = Symbol.for("wcstack.ssr.snapshotBuilder");

export const isServer = (): boolean => document.documentElement?.hasAttribute("data-wcs-server") === true;

const mark = (data: string): Comment => document.createComment(data);
const isMark = (n: Node | null, data: string): boolean => n !== null && n.nodeType === 8 && (n as Comment).data === data;
const startsMark = (n: Node | null, prefix: string): boolean => n !== null && n.nodeType === 8 && (n as Comment).data.startsWith(prefix);

// ---------------------------------------------------------------- server

/** Page-level anchors (the walker's) and the template each replaced, by engine. */
const anchors = new WeakMap<Engine, Map<Node, Element>>();
/** The engines that recorded anchors in a page (its root node): the page's, and its Light DOM components'. */
const enginesByRoot = new WeakMap<Node, Set<Engine>>();
/**
 * The custom elements the page's walker bound, with the nodes in them then (and a text's data): the
 * walk is post-order, so its anchors, text marks and rows are there, and the element's own bindings
 * have not written yet. What an element renders from a value comes later: in the server's HTML the
 * client would walk it as the page's markup (a user's `{{ … }}`, a `data-wcs` in sanitized HTML),
 * so the snapshot leaves it — and a text with `{{` that it was not then (a value's, in a node of
 * its own or one the page wrote) — to the client.
 */
const kept = new WeakMap<Node, Map<Node, string>>();
/** What the client does not walk: a region (rows it adopts), an element whose content a binding sets. */
const skip = new WeakSet<Node>();
/**
 * Mustache texts: their expressions. In an element whose content is text (`<textarea>`, `<title>`),
 * a mark would be text to the browser, and the value the client's markup: the element takes its
 * template along instead (`data-wcs-raw`), and the client puts it back before binding the page.
 */
const rawTexts = new WeakMap<Node, string>();

/** Nodes from `from` to `to`, siblings, inclusive. */
function range(from: Node, to: Node): Node[] {
  const out: Node[] = [];
  for (let n: Node | null = from; n !== null; n = n.nextSibling) {
    out.push(n);
    if (n === to) break;
  }
  return out;
}

/** `to` with `from`'s attributes, and `content` (into a template's content when it has one). */
function attrs<T extends Element>(from: Element, to: T, ...content: Node[]): T {
  for (const a of Array.from(from.attributes)) to.setAttribute(a.name, a.value);
  ((to as unknown as HTMLTemplateElement).content ?? to).append(...content);
  return to;
}

const lastOf = (b: Block): Node => (b.nodes === null ? b.first : b.nodes[b.nodes.length - 1]);

/** Moves the blocks' nodes right after `after`, as one region. */
function region(after: Node, blocks: Block[], branch: number | null): void {
  const nodes: Node[] = [mark(branch === null ? "wcs-[" : `wcs-[:${branch}`)];
  for (const b of blocks) {
    if (branch === null) nodes.push(mark("wcs-|"));
    nodes.push(...range(b.first, lastOf(b)));
  }
  nodes.push(mark("wcs-]"));
  (after as ChildNode).after(...nodes);
  for (const n of nodes) skip.add(n);
}

function visitView(v: ForView | IfView): void {
  if (v instanceof ForView) {
    region(v.anchor, v.rowViews, null);
    for (const b of v.rowViews) visitBlock(b);
    return;
  }
  const cur = v.current;
  if (cur === null) return;
  region(v.branches[v.branches.length - 1].anchor, [cur], v.index);
  visitBlock(cur);
}

function visitBlock(b: Block): void {
  if (b.children !== null) for (const c of b.children) visitView(c);
}

const RAW = new Set(["script", "style", "template", "textarea", "title"]);
const RAW_ATTR = "data-wcs-raw";
const raw = (el: Element): boolean => RAW.has(el.localName) || el.localName === tag();

/** Keeps every text node a text node through HTML serialization and parsing. */
function protectTexts(parent: Node): void {
  for (const n of Array.from(parent.childNodes)) {
    if (n.nodeType === 3) {
      if ((n as Text).data === "") n.replaceWith(mark("wcs-e"));
      else if (n.nextSibling !== null && n.nextSibling.nodeType === 3) n.after(mark("wcs-s"));
    } else if (n.nodeType === 1 && !raw(n as Element)) {
      protectTexts(n);
    }
  }
}

function json(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The state's own data (no `$` keys, no accessors, no functions). */
function data(target: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(target)) {
    if (key[0] === "$") continue;
    const d = Object.getOwnPropertyDescriptor(target, key)!;
    if (d.get !== undefined || d.set !== undefined || typeof d.value === "function") continue;
    out[key] = d.value;
  }
  return out;
}

let ids = 0;

function snapshot(el: Element, engine: Engine): void {
  const root = el.getRootNode() as Document | ShadowRoot;
  // the page's engine, and those of the Light DOM components in it: their walkers' anchors are in
  // the page too (a Shadow DOM component's are in its own shadow root)
  const engines = [engine];
  for (const E of enginesByRoot.get(root) ?? []) {
    if (E !== engine && (E.element as Element | null)?.hasAttribute("bind-component") === true) engines.push(E);
  }
  const map = new Map<Node, Element>();
  for (const E of engines) {
    const own = anchors.get(E);
    if (own === undefined) continue;
    // the views the walker made, top down (a nested view's region stays inside its row's)
    const byAnchor = new Map<Node, ForView | IfView>();
    for (const l of E.rootLists.values()) {
      if (l.view !== null) byAnchor.set(l.view.anchor, l.view);
      if (l.extra !== null) for (const v of l.extra) byAnchor.set(v.anchor, v);
    }
    for (const bs of E.rootBindings.values()) {
      for (const b of bs) if (b.chain !== null) for (const br of b.chain.branches) byAnchor.set(br.anchor, b.chain);
    }
    const done = new Set<ForView | IfView>();
    for (const [anchor, template] of own) {
      map.set(anchor, template);
      const v = byAnchor.get(anchor);
      if (v !== undefined && !done.has(v) && anchor.isConnected) {
        done.add(v);
        visitView(v);
      }
    }
  }
  for (const h of Array.from(root.querySelectorAll("*"))) {
    const own = kept.get(h);
    if (own !== undefined) {
      // what the client does not walk is left: what `skip` has, and — the page's — a Light DOM
      // component (bound later, by its own engine). A text without `{{` is no markup to the client,
      // whoever wrote it; one the page wrote is left as it was written, and a mustache's where the
      // client puts its expression back: right after its mark (the client replaces what follows it),
      // or in a text element (`data-wcs-raw`). Elsewhere it goes: an element may drop comments, or
      // move a text element's text out, and its value would be the client's markup
      const w = document.createTreeWalker(h, 133, {
        acceptNode: (n) => (skip.has(n) || (n.nodeType === 1 && own.has(n) && scoped(n as Element)) ? 2 : 1),
      });
      const out: ChildNode[] = [];
      for (let n = w.nextNode(); n !== null; n = w.nextNode()) {
        const p = n.previousSibling!;
        if (n.nodeType === 3
          ? (n as Text).data.includes("{{")
            && !(raw(n.parentNode as Element) ? rawTexts.has(n) : own.has(p) && startsMark(p, "wcs-t:"))
            && (rawTexts.has(n) || own.get(n) !== (n as Text).data)
          : !own.has(n)) out.push(n as ChildNode);
      }
      for (const n of out) n.remove();
    }
    const cs = Array.from(h.childNodes);
    if (raw(h) && cs.some((c) => rawTexts.has(c))) {
      // (a comment there — a server's DOM may parse one in a <textarea> — is text to a browser)
      h.setAttribute(RAW_ATTR, cs.map((c) => (rawTexts.has(c) ? `{{ ${rawTexts.get(c)} }}` : c.nodeType === 8 ? `<!--${(c as Comment).data}-->` : c.textContent)).join(""));
    }
  }
  protectTexts(root.nodeType === 9 ? (root as Document).body : root);
  const ssr = document.createElement(tag());
  ssr.setAttribute("version", VERSION);
  const script = document.createElement("script");
  script.type = "application/json";
  script.textContent = json(data(engine.target));
  ssr.append(script);
  for (const [anchor, template] of map) {
    if (!anchor.isConnected) continue;
    // the anchor's context, by name (a server's DOM may not know <foreignObject> leads back to HTML):
    // SVG under <svg> — its id says so (`wcs-s…`) — and HTML under <foreignObject>
    let e = anchor.parentNode as Element | null;
    while (e !== null && e.localName !== "svg" && e.localName !== "foreignObject") e = e.parentElement;
    const svg = e?.localName === "svg";
    const id = `wcs-${svg ? "s" : "t"}${ids++}`;
    (anchor as ChildNode).replaceWith(mark(`wcs-p:${id}`));
    let c: Node = document.importNode(templateContent(template as HTMLTemplateElement), true);
    // a template in it that is an SVG element goes as an HTML one, which a serializer reads (the
    // client's parser reads it back in its context)
    for (const x of Array.from((c as Element).querySelectorAll("template"))) {
      if (x instanceof SVGElement) x.replaceWith(attrs(x, document.createElement("template"), ...x.childNodes));
    }
    // an SVG template's content goes in <svg>, so the client's parser reads it as SVG
    if (svg) {
      const w = document.createElementNS(e!.namespaceURI, "svg");
      w.append(c);
      c = w;
    }
    const t = document.createElement("template");
    t.id = id;
    ssr.append(attrs(template, t, c));
  }
  el.before(ssr);
}

/**
 * The form controls' current state into their markup, as 3.x wrote it: an input's value (its
 * `value` attribute) and checkedness (`checked`), a textarea's value (its text), the options a
 * select has selected (`selected`) — whatever set them (a `value:` / `checked:` / `selectedIndex:`
 * binding, `radio:`, a row's), where it differs from what the markup gives back. The page then shows
 * the server's values before the client binds it, or without JS; the client's bindings find them
 * there, and write over them from then on. On a page with a `<wcs-state>` only (enable-ssr or not).
 * A password's value never goes into the HTML (3.x wrote it): the client's binding fills it in.
 */
function forms(doc: Document): void {
  if (doc.querySelector(config.tagNames.state) === null) return;
  for (const n of Array.from(doc.querySelectorAll<any>("input,textarea,select"))) {
    if (n.localName === "select") {
      const o: HTMLOptionElement[] = Array.from(n.options);
      // (a single select without a marked option, its first enabled one selected: what a parser selects)
      if (n.multiple || o.some((x) => x.hasAttribute("selected")) || o[n.selectedIndex] !== o.find((x) => !x.disabled)) {
        for (const x of o) x.toggleAttribute("selected", x.selected);
      }
    } else if (n.localName === "textarea") {
      // (a value with `{{` in it would be the client's markup there, a mustache; a mustache in it is
      // the client's to put back — see snapshot: both left to the client)
      if (n.value !== n.defaultValue && !n.value.includes("{{") && !Array.from(n.childNodes).some((c) => rawTexts.has(c as Node))) n.textContent = n.value;
    } else if (n.type === "checkbox" || n.type === "radio") {
      n.toggleAttribute("checked", n.checked);
    } else if (n.type !== "password" && n.value !== n.defaultValue) {
      n.setAttribute("value", n.value);
    }
  }
}

/** The builder the server calls before it serializes (protocol wcs-ssr-snapshot v1). */
function build(doc: Document): void {
  // first: moving the rows into their regions (snapshot) may change what a select has selected
  forms(doc);
  for (const el of Array.from(doc.querySelectorAll(`${config.tagNames.state}[enable-ssr]`))) {
    if (el.hasAttribute("mount") || el.hasAttribute("bind-component")) continue;
    if (el.previousElementSibling?.localName === tag()) continue;
    const engine = (el as any).engine as Engine | null;
    if (engine !== null && engine !== undefined) snapshot(el, engine);
  }
}

/** Where the builder finds this module: the latest evaluation (a server may load one per render). */
const IMPL = Symbol.for("wcstack.state.ssr.impl");

export function installBuilder(): void {
  const g = globalThis as any;
  g[IMPL] = { build, reset() { ids = 0; } };
  // another engine's builder (the current @wcstack/state) is not replaced
  if (g[BUILDER] === undefined) {
    g[BUILDER] = { protocol: "wcs-ssr-snapshot", version: 1, build: (doc: Document) => g[IMPL].build(doc), reset: () => g[IMPL].reset() };
  }
}

// ---------------------------------------------------------------- client

interface Region {
  /** The branch the region renders (null: a list). */
  readonly branch: number | null;
  /** Each row's nodes, where the server put them (a region in the row included). */
  readonly rows: Node[][];
  /**
   * The region's end mark, after its rows: the server put a view's rows after its anchor, and the view
   * renders them before it — the anchor goes here when the view takes the first row (null after).
   */
  tail: ChildNode | null;
}

/** Regions waiting for their view, by the node right before them (a view's anchor). */
const held = new Map<Node, Region>();

/**
 * The Light DOM components of a page being hydrated, by host: their content is bound by their own
 * engine, which starts later (once its host is wired, or its class defined), so it keeps the
 * server's nodes until then and is prepared when that engine binds it (adoptScope).
 */
const deferred = new WeakMap<Node, { ssr: Element; adopt: boolean }>();
const scoped = (el: Element): boolean => hooks.componentScope?.(el) === true;

/** An element regions may be in: not a text element, nor a Light DOM component (its engine reads its own). */
const enters = (n: Node): boolean => n.nodeType === 1 && !raw(n as Element) && !scoped(n as Element);

/** A region's nodes: its rows', and its end mark. */
const nodesOf = (r: Region): Node[] => r.rows.flat().concat(r.tail ?? []);

/** Takes a region's nodes out of the page (rows no view took, or not the plan's). */
const drop = (r: Region): void => {
  for (const n of nodesOf(r)) (n as ChildNode).remove();
};

/**
 * Reads the region `start` opens where it is: its marks go but its end mark, and its nodes stay (no
 * custom element in them is disconnected). It is held by the node before it, its view's anchor (the
 * page's walk then passes its nodes by: its blocks bind them where they are), or dropped (`keep`
 * false, or no node before it). A region in it — in a row, after a view's anchor of the row, or in an
 * element of it — is read in turn. Its nodes go in `row` (the row it is in); returns the node after it.
 */
function read(start: Comment, keep: boolean, row?: Node[]): Node | null {
  const m = /^wcs-\[(?::(\d+))?/.exec(start.data)!;
  const key = start.previousSibling;
  const parent = start.parentNode!;
  const rows: Node[][] = [];
  let n: Node | null = start.nextSibling;
  start.remove();
  while (n !== null && !isMark(n, "wcs-]")) {
    let next: Node | null = n.nextSibling;
    if (isMark(n, "wcs-|")) {
      rows.push([]);
      (n as ChildNode).remove();
    } else {
      // (a branch has no row marks; a list's node before its first one is a value's)
      if (rows.length === 0) rows.push([]);
      const own = rows[rows.length - 1];
      if (startsMark(n, "wcs-[")) next = read(n as Comment, keep, own);
      else {
        own.push(n);
        if (enters(n)) strip(n, keep);
      }
    }
    n = next;
  }
  // (cut short — a parser moved its end mark into an element (see mend): it ends with its parent)
  const r: Region = { branch: m[1] === undefined ? null : Number(m[1]), rows, tail: (n ?? parent.appendChild(mark("wcs-]"))) as ChildNode };
  const nodes = nodesOf(r);
  n = r.tail!.nextSibling;
  // (not spread: a region may have more nodes than a call takes arguments)
  for (const x of nodes) {
    row?.push(x);
    if (keep) walked.add(x);
  }
  if (keep && key !== null) {
    held.set(key, r);
  } else {
    drop(r);
  }
  return n;
}

/** Reads every region under `parent` (see read). */
function strip(parent: Node, keep: boolean): void {
  for (let n: Node | null = parent.firstChild; n !== null; ) {
    if (startsMark(n, "wcs-[")) {
      n = read(n as Comment, keep);
    } else {
      if (enters(n)) strip(n, keep);
      n = n.nextSibling;
    }
  }
}

/** Texts and templates back to what the page was written with; the regions read (see strip). */
function prepare(container: Node, ssr: Element, adopt: boolean): void {
  const walk = (parent: Node): void => {
    for (const n of Array.from(parent.childNodes)) {
      // a text marker takes the nodes up to its end with it
      if (n.parentNode !== parent) continue;
      if (n.nodeType === 8) {
        const d = (n as Comment).data;
        // (a mark the server did not write — in a value — that does not parse is left as it is;
        // a string given to replaceWith goes in as a text node)
        try {
          if (d === "wcs-s") n.remove();
          else if (d === "wcs-e") n.replaceWith("");
          else if (d.startsWith("wcs-t:")) {
            // the value between the markers, back to a text binding: a comment binding, which binds
            // whether or not the page's mustaches are on (it was a mustache, or a comment binding)
            const text = mark(`@@:${decodeURIComponent(d.slice(6))}`);
            let e: ChildNode | null = n.nextSibling;
            while (e !== null && !isMark(e, "wcs-/t")) {
              const next = e.nextSibling;
              e.remove();
              e = next;
            }
            e?.remove();
            n.replaceWith(text);
          } else if (d.startsWith("wcs-p:")) {
            const t = ssr.querySelector(`template[id="${d.slice(6)}"]`) as HTMLTemplateElement | null;
            if (t !== null) {
              const p = n.parentNode as Element;
              // an SVG template (`wcs-s…`): its content came in <svg> (so parsed as SVG)
              const copy = d[10] === "s"
                ? attrs(t, document.createElementNS(p.namespaceURI, "template"), ...document.importNode(t.content.firstChild!, true).childNodes)
                : document.importNode(t, true);
              copy.removeAttribute("id");
              p.replaceChild(copy, n);
            }
          }
        } catch { /* */ }
      } else if (n.nodeType === 1 && !raw(n as Element)) {
        if (scoped(n as Element)) deferred.set(n, { ssr, adopt });
        else walk(n);
      }
    }
  };
  walk(container);
  mend(container);
  strip(container, adopt);
}

/**
 * A region a parser cut: its start mark in a <table>, its rows and end mark in the <tbody> the parser
 * added at its first <tr> (the regions after it with them). The comments and templates right before
 * the <tbody> that the cut region starts with go into it — its anchor and marks: nothing in them
 * connects — and the rows stay where they are. A <tbody> written in the page (a row of a list of
 * them, a branch) holds no end mark of a region that starts before it, and is left alone.
 */
function mend(container: Node): void {
  for (const body of Array.from((container as ParentNode).querySelectorAll("table > tbody"))) {
    const run: Node[] = [];
    for (let p = body.previousSibling; p !== null && (p.nodeType === 8 || isBlank(p) || (p as Element).localName === "template"); p = p.previousSibling) run.unshift(p);
    // the regions the run leaves open (an end mark whose start is before the run — past an element —
    // closes a region that stays where it is, with what comes before the mark)
    let from = 0;
    let open = 0;
    run.forEach((n, i) => {
      if (startsMark(n, "wcs-[")) open++;
      else if (isMark(n, "wcs-]") && --open < 0) {
        open = 0;
        from = i + 1;
      }
    });
    if (open === 0) continue;
    // ... and the <tbody> ends one: the parser moved its rows in
    let depth = 0;
    for (let c = body.firstChild; c !== null; c = c.nextSibling) {
      if (startsMark(c, "wcs-[")) depth++;
      else if (isMark(c, "wcs-]") && depth-- === 0) {
        body.prepend(...run.slice(from));
        break;
      }
    }
  }
}

/**
 * The `adoptScope` hook: a Light DOM component's engine binds its host. Its content is prepared
 * now, and its blocks take the server's nodes while its walk runs (a walk adopts synchronously).
 * What it did not adopt is dropped after the walk: the regions held then are its own (a page's are
 * read and adopted in one go too, and dropped before anything else runs).
 */
export function adoptScope(host: Node): (() => void) | null {
  const d = deferred.get(host);
  if (d === undefined) return null;
  deferred.delete(host);
  prepare(host, d.ssr, d.adopt);
  if (!d.adopt) return null;
  const prev = hooks.adopt;
  hooks.adopt = adopt;
  return () => {
    hooks.adopt = prev;
    release();
  };
}

/** Drops the held regions: rows no view took. */
function release(): void {
  for (const r of held.values()) drop(r);
  held.clear();
}

/** The comments under `scope`, in document order. */
function comments(scope: Node): Comment[] {
  const out: Comment[] = [];
  for (const w = document.createTreeWalker(scope, 128); w.nextNode(); ) out.push(w.currentNode as Comment);
  return out;
}

/**
 * A Light DOM component's wiring, one entry per mapping: [the page's path (null: not known — a key
 * private to the component around), its own path ("" for a whole mount, `state: user`), the path as
 * its host wrote it (null at the top: the page's)].
 */
type Wiring = (string | null)[][];

/** `path` from column `from` of `wiring` to column `to`, by the longest it is or starts with; null: none. */
function across(wiring: Wiring, path: string, from: number, to: number): string | null {
  let best: (string | null)[] | null = null;
  for (const w of wiring) {
    const k = w[from];
    if (k !== null && (k === "" || path === k || path.startsWith(`${k}.`)) && (best === null || k.length > best[from]!.length)) best = w;
  }
  const v = best?.[to];
  if (v == null) return null;
  const k = best![from]!;
  const rest = k === "" ? path : path.slice(k.length + 1);
  return v === "" ? rest : rest === "" ? v : `${v}.${rest}`;
}

/**
 * The output of @wcstack/server 3.x back to the page as written, as 3.x's own fallback did
 * (`Ssr.cleanupDom`): a row or a branch (`<!--@@wcs-for-start:…-->` up to its `-end` mark among its
 * siblings) goes, a text between its marks becomes a comment binding of what the mark holds (before
 * 3.5.3 the path alone, its filters lost: the warning says so; from 3.5.3, `fresh`, the binding's
 * expression as written: wcstack#373), a template's mark (`<!--@@wcs-for:ID-->`) becomes the template
 * `<wcs-ssr>` keeps under that id (whose content has the marks of the templates in it), and the
 * elements lose `data-wcs-ssr-id`.
 *
 * In a Light DOM component, 3.x wrote a template's own path as the page's (`state: user` makes `name`
 * `user.name`; a private key `user.#m1.name`, or `#m2.name` in a partial mount; in a component in a
 * component, through both), and so the marks' paths before 3.5.3: they go back to the component's own
 * through its host's wiring (the content of a template is the component's already). A mark from 3.5.3
 * is the component's own text, not mapped (it may name a key that is one of the page's wired paths
 * too: `state.x: v; state.v: w`). An expression a comment cannot hold (one with a `--`) falls back to
 * its path, unfiltered. From 3.5.4 (wcstack#427) that is the path the component wrote, read as written
 * like any other mark: the value shows, without its filters. 3.5.3 wrote the page's path there
 * instead, which is mapped back when it names a private key (`#mN.`: never in the component's own
 * text, so the mapping cannot misread a 3.5.4 mark); a wired one cannot be told from the component's
 * own text, and is read as it — a component key of that name shows its value, the right one only when
 * the wiring keeps the name, else the text stays empty (a limit of 3.5.3 output only: migration guide
 * §3.6).
 */
function legacy(container: Node, ssr: Element, fresh: boolean): void {
  const wirings = new Map<Element, Wiring>();
  /** The wiring of the Light DOM component `n` is in (a nested one's composed with the one around), or null. */
  const wiringOf = (n: Node): Wiring | null => {
    let h = n.parentElement;
    while (h !== null && !scoped(h)) h = h.parentElement;
    if (h === null) return null;
    let wiring = wirings.get(h);
    if (wiring === undefined) {
      const up = wiringOf(h);
      const prop = h.querySelector(`:scope > ${config.tagNames.state}[bind-component]`)!.getAttribute("bind-component");
      wirings.set(h, (wiring = []));
      for (const b of parseBindTextsForElement(h.getAttribute(config.bindAttributeName) ?? "")) {
        const at = b.statePathName;
        if (b.propSegments[0] === prop) wiring.push([up ? across(up, at, 1, 0) : at, b.propSegments.slice(1).join("."), up && at]);
      }
    }
    return wiring;
  };
  /**
   * A path 3.x wrote at `n`, as the component's own there (`asIs`: a text mark from 3.5.3, left as it
   * is but for a private key's path, which 3.5.3's fallback writes).
   */
  const own = (n: Node, path: string, asIs?: boolean): string => {
    const wiring = wiringOf(n);
    if (wiring === null) return path;
    // (no `|`: a mark with filters, from 3.5.3, is the component's own text, a `#m1.` in it an argument's)
    const m = /^([^|]*)#m\d+\.([^|]*)$/.exec(path);
    if (m === null) return asIs ? path : across(wiring, path, 0, 1) ?? path;
    // after the last private key mark, a component's own path: this one's when what comes before the
    // mark is this one's mount path (`user.#m1.name`, `user.profile.#m3.name`, `#m2.box.#m4.name` with
    // `state: box`; nothing for a partial mount, `#m2.name`), else the one's around it, which this one
    // is mounted on (`#m2.box.k` with `state: box`)
    const at = m[1].replace(/#m\d+\./g, "").slice(0, -1);
    return wiring.some((w) => w[1] === "" && (w[0] === at || w[2] === at)) ? m[2] : across(wiring, m[2], 2, 1) ?? m[2];
  };
  // from the last: a row's own marks go before the row does
  for (const c of comments(container).reverse()) {
    const m = /^@@wcs-(\w+)-start:([\s\S]*)/.exec(c.data);
    if (m === null) continue;
    // (no end among its siblings — an output cut short: left as it is)
    let e = c.nextSibling;
    while (e !== null && !isMark(e, `@@wcs-${m[1]}-end:${m[2]}`)) e = e.nextSibling;
    if (e === null) continue;
    while (c.nextSibling !== e) c.nextSibling!.remove();
    e.remove();
    c.replaceWith(...(m[1] === "text" ? [mark(`@@:${own(c, m[2], fresh)}`)] : []));
  }
  const restore = (scope: Node, at?: Node): void => {
    for (const c of comments(scope)) {
      const id = /^@@wcs-(?:for|if|elseif|else):(\S+)$/.exec(c.data)?.[1];
      const t = Array.from(ssr.querySelectorAll("template")).find((x) => x.id === id);
      if (t === undefined) continue;
      const copy = document.importNode(t, true);
      const a = config.bindAttributeName;
      copy.removeAttribute("id");
      copy.setAttribute(a, copy.getAttribute(a)!.replace(/^(\s*\w+\s*:\s*)([^\s|]+)/, (_, k: string, p: string) => k + own(at ?? c, p)));
      restore(copy.content, at ?? c);
      // 3.x made each `elseif` an `if` in an `else` of its own (whose content starts with it): back
      // to the chain of templates it was written as
      const f = copy.content.firstChild as Element | null;
      c.replaceWith(...(/^\s*elseif\s*:/.test(f?.getAttribute?.(a) ?? "") ? copy.content.childNodes : [copy]));
    }
  };
  restore(container);
  for (const e of Array.from((container as ParentNode).querySelectorAll("[data-wcs-ssr-id]"))) e.removeAttribute("data-wcs-ssr-id");
}

/** The `element` hook, "mounting": a client root with a server snapshot adopts the server's DOM. */
export function hydrate(engine: Engine): void {
  const el = engine.element as Element;
  if (!el.hasAttribute("enable-ssr") || isServer()) return;
  const ssr = el.previousElementSibling;
  const found = ssr?.localName === tag();
  const version = found ? ssr!.getAttribute("version") : null;
  const same = version === null || majorMinor(version) === majorMinor(VERSION);
  if (same) {
    // the server ran $connectedCallback; the client does not
    const e = engine as any;
    const callHook = e.callHook;
    e.callHook = (name: string, args?: unknown[]) => (name === "$connectedCallback" ? undefined : callHook.call(engine, name, args));
  }
  if (!found) return;
  // @wcstack/server 3.x's output: marks of its own; from 3.5.3 on a text mark holds the binding's
  // expression (see legacy). A prerelease, or a version that does not parse, counts as older
  const old = !same && parseInt(version!) < 4;
  const v = /^3\.(\d+)\.(\d+)$/.exec(version!);
  const fresh = v !== null && (+v[1] - 5 || +v[2] - 3) >= 0;
  if (!same) {
    // (the filters' sentence: output before 3.5.3 only)
    console.warn(`[@wcstack/state] <${tag()} version="${version}"> does not match ${VERSION}: its snapshot is discarded, and the page renders on the client from its own state.${old && !fresh
      ? " 3.x output keeps only the path of a text binding outside a template, so such a binding loses its filters: deploy @wcstack/server 4.0 with this client."
      : ""}`);
  }
  const script = same ? ssr!.querySelector('script[type="application/json"]') : null;
  if (script !== null) {
    const snap = JSON.parse(script.textContent || "{}") as Record<string, unknown>;
    const target = engine.target;
    for (const key of Object.keys(snap)) {
      const d = Object.getOwnPropertyDescriptor(target, key);
      if (d !== undefined && (d.get !== undefined || d.set !== undefined || typeof d.value === "function")) continue;
      target[key] = snap[key];
    }
    // the snapshot holds the server's volume data too: a volume adopts it (scopes/volume.ts)
    (engine as any).hydrated = true;
  }
  const root = el.getRootNode() as Document | ShadowRoot;
  for (const r of Array.from(root.querySelectorAll(`[${RAW_ATTR}]`))) {
    r.textContent = r.getAttribute(RAW_ATTR);
    r.removeAttribute(RAW_ATTR);
  }
  const container = root.nodeType === 9 ? (root as Document).body : root;
  if (old) legacy(container, ssr!, fresh);
  else prepare(container, ssr!, same);
  ssr!.remove();
  if (same) {
    // only while the page is adopted — its walk, which runs now: every other block is built with one
    // null check. What no view took then goes before anything else runs
    hooks.adopt = adopt;
    queueMicrotask(() => {
      release();
      hooks.adopt = null;
    });
  }
}

/**
 * The `ssrMark` hook: on the server, records (and leaves `outerHTML:` / `outerText:` to the client); on the client,
 * a held region follows its template's anchor.
 */
export function ssrMark(engine: Engine, node: Node, source: Element | string | Spec[]): void {
  if (isServer()) {
    if (source instanceof Array) {
      // `outerHTML:` / `outerText:` replace the element with the value: the client would find no
      // binding there, and walk the value as the page's markup. The server renders the element as
      // written; the client binds it and applies the value
      for (let i = source.length; i-- > 0; ) if (isOuter(source[i])) source.splice(i, 1);
      // a custom element (a Light DOM component binds its own) whose content no binding sets: what
      // is in it now is the page's (see kept)
      const el = node as Element;
      if (source.some(setsContent)) skip.add(el);
      else if (el.localName.includes("-") && !scoped(el)) {
        const own = new Map<Node, string>();
        for (const w = document.createTreeWalker(el, 133); w.nextNode(); ) own.set(w.currentNode, (w.currentNode as Text).data);
        kept.set(el, own);
      }
      return;
    }
    if (typeof source === "string") {
      rawTexts.set(node, source);
      if (raw(node.parentNode as Element)) return;
      const open = mark(`wcs-t:${encodeURIComponent(source)}`);
      const close = mark("wcs-/t");
      (node as Text).before(open);
      (node as Text).after(close);
      return;
    }
    let map = anchors.get(engine);
    if (map === undefined) anchors.set(engine, (map = new Map()));
    map.set(node, source);
    const root = node.getRootNode();
    let es = enginesByRoot.get(root);
    if (es === undefined) enginesByRoot.set(root, (es = new Set()));
    es.add(engine);
    return;
  }
  // (an element's specs are never a key: the templates the anchors replaced are)
  if (typeof source !== "string" && held.size > 0) {
    const r = held.get(source as Element);
    if (r !== undefined) {
      held.delete(source as Element);
      held.set(node, r);
    }
  }
}

/** An anchor of an `if` / `elseif` / `else` chain (the core names them by config). */
const isIfAnchor = (n: Node | null): boolean =>
  n !== null && n.nodeType === 8 && [config.commentIfPrefix, config.commentElseIfPrefix, config.commentElsePrefix].includes((n as Comment).data);
const isBlank = (n: Node): boolean => n.nodeType === 3 && (n as Text).data.trim() === "";

/** The next of the plan's nodes after `n`: a held region after an anchor is the anchor's view's. */
const after = (n: Node): Node | null => (held.get(n)?.tail ?? n).nextSibling;

/**
 * Whether a row's top-level nodes `own` have the plan's nodes where a binding lands — not so when a
 * Light DOM element added children before them, or a parser moved them (see mend); puts them
 * in `plan.scratch` for the block.
 */
function fits(plan: RowPlan, own: Node[]): boolean {
  if (own.length !== plan.fragment.childNodes.length) return false;
  const paths = plan.nodePaths;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    let a: Node = plan.fragment;
    let b: Node | null | undefined = own[path[0]];
    for (let j = 0; ; ) {
      a = a.childNodes[path[j]];
      if (b?.nodeName !== a.nodeName) return false;
      if (++j === path.length) break;
      b = b.firstChild;
      for (let k = path[j]; k > 0 && b !== null; k--) b = after(b);
    }
    plan.scratch[i] = b;
  }
  return true;
}

/**
 * The `adopt` hook: the next server row (or branch) of the view anchored at `anchor` — its top-level
 * nodes, left where they are (the view inserts nothing, and no custom element in them is disconnected).
 */
export function adopt(plan: RowPlan, anchor: Node, isFor: boolean): ChildNode[] | null {
  if (held.size === 0) return null;
  let key = anchor;
  let branch = 0;
  if (!isFor) {
    // only this chain: an `if` anchor starts one (a chain right before or after is another)
    const head = config.commentIfPrefix;
    if (!isMark(anchor, head)) {
      for (let p = anchor.previousSibling; p !== null && (isIfAnchor(p) || isBlank(p)); p = p.previousSibling) {
        if (isIfAnchor(p)) branch++;
        if (isMark(p, head)) break;
      }
    }
    // up to the anchor its region follows (the branch's nodes come right after it)
    for (let n = anchor.nextSibling; !held.has(key) && n !== null && !isMark(n, head) && (isIfAnchor(n) || isBlank(n)); n = n.nextSibling) {
      if (isIfAnchor(n)) key = n;
    }
  }
  const r = held.get(key);
  if (r === undefined) return null;
  if (!isFor && r.branch !== branch) {
    // the server rendered another branch: it goes, this one is built
    held.delete(key);
    drop(r);
    return null;
  }
  const nodes = r.rows.shift();
  if (r.rows.length === 0) held.delete(key);
  // a view renders before its anchor (a branch before its own: the chain's anchors from it on), and
  // the server put its rows after: the anchors go where the rows end
  r.tail?.replaceWith(...range(anchor, key));
  r.tail = null;
  if (nodes === undefined) return null;
  // the row's own top-level nodes (a region in it is a nested view's)
  let own: Node[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const inner = held.get(nodes[i]);
    own.push(nodes[i]);
    // (its nodes follow it, up to its end mark)
    if (inner !== undefined) while (i < nodes.length && nodes[i] !== inner.tail) i++;
  }
  if (!fits(plan, own)) {
    // rendered anew, in its place (the rows around it stay; an empty one's place is before the next
    // row, or the anchor): its nodes found before it is in the page (a custom element in it may add
    // children as it connects)
    const fresh = (plan.single ? plan.root! : plan.fragment).cloneNode(true);
    own = plan.single ? [fresh] : [...fresh.childNodes];
    fits(plan, own);
    ((nodes[0] ?? r.rows.find((x) => x.length > 0)?.[0] ?? anchor) as ChildNode).before(fresh);
    for (const n of nodes) (n as ChildNode).remove();
  }
  return own as ChildNode[];
}
