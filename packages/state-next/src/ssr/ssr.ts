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
 *   `<template id=ID>`; a page-level mustache text is wrapped in `<!--wcs-t:EXPR-->…<!--wcs-/t-->`;
 * - adjacent text nodes are separated (`<!--wcs-s-->`) and empty ones kept (`<!--wcs-e-->`), so
 *   parsing the HTML gives back the rows' exact structure;
 * - `<wcs-ssr version>` before the element holds the state's data (JSON) and the templates.
 *
 * Client: before the page is bound, the texts and templates are restored and the page-level
 * regions detached; each block the engine builds takes its region's next row instead of a clone
 * (a row's nested regions are detached and held for its nested views in turn), so the server's
 * nodes stay and get their bindings. `$connectedCallback` does not run (the server ran it). A
 * snapshot of another major.minor is discarded and the page renders on the client.
 *
 * Not carried over from @wcstack/state 3.3 (approved): the inline snapshot for servers without
 * the builder protocol, and the property value table (every binding is applied on adoption).
 */
import type { Engine } from "../engine";
import { ForView, type Block, type IfView, type RowPlan, type Spec } from "../dom/view";
import { config } from "../config";
import { hooks } from "../hooks";

import { VERSION } from "../version";
import { isOuter, setsContent, templateContent } from "../dom/plan";
import { majorMinor } from "./element";
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
      if ((n as Text).data === "") n.parentNode!.replaceChild(mark("wcs-e"), n);
      else if (n.nextSibling !== null && n.nextSibling.nodeType === 3) n.parentNode!.insertBefore(mark("wcs-s"), n.nextSibling);
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
    if (raw(h)) {
      const t = Array.from(h.childNodes, (c) => (rawTexts.has(c) ? `{{ ${rawTexts.get(c)} }}` : c.textContent)).join("");
      if (t !== h.textContent) h.setAttribute(RAW_ATTR, t);
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
    anchor.parentNode!.replaceChild(mark(`wcs-p:${id}`), anchor);
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
  el.parentNode!.insertBefore(ssr, el);
}

/** The builder the server calls before it serializes (protocol wcs-ssr-snapshot v1). */
function build(doc: Document): void {
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
  readonly rows: Node[][];
}

/** Regions waiting for their view, by the node right before them (a view's anchor). */
const held = new Map<Node, Region>();
const hydrating = new WeakSet<Engine>();

/**
 * The Light DOM components of a page being hydrated, by host: their content is bound by their own
 * engine, which starts later (once its host is wired, or its class defined), so it keeps the
 * server's nodes until then and is prepared when that engine binds it (adoptScope).
 */
const deferred = new WeakMap<Node, { ssr: Element; adopt: boolean }>();
const scoped = (el: Element): boolean => hooks.componentScope?.(el) === true;

/** Detaches the region starting at `start` (its markers included); its rows. */
function detach(start: Comment): Region {
  const m = /^wcs-\[(?::(\d+))?/.exec(start.data)!;
  const rows: Node[][] = [];
  let depth = 0;
  let n: Node | null = start.nextSibling;
  start.remove();
  while (n !== null) {
    const next: Node | null = n.nextSibling;
    if (depth === 0 && isMark(n, "wcs-]")) {
      n.parentNode!.removeChild(n);
      break;
    }
    if (depth === 0 && isMark(n, "wcs-|")) rows.push([]);
    else {
      if (startsMark(n, "wcs-[")) depth++;
      else if (isMark(n, "wcs-]")) depth--;
      // (a branch has no row marks; a list's node before its first one is a value's)
      if (rows.length === 0) rows.push([]);
      rows[rows.length - 1].push(n);
    }
    n.parentNode!.removeChild(n);
    n = next;
  }
  return { branch: m[1] === undefined ? null : Number(m[1]), rows };
}

/** Holds every region directly under `nodes` (not inside another), keyed by the node before it. */
function holdRegions(nodes: Iterable<Node>, keep: boolean): void {
  for (const n of Array.from(nodes)) {
    if (startsMark(n, "wcs-[")) {
      const key = n.previousSibling;
      const r = detach(n as Comment);
      if (keep && key !== null) held.set(key, r);
    } else if (n.nodeType === 1 && !raw(n as Element) && !scoped(n as Element)) {
      holdRegions((n as Element).childNodes, keep);
    }
  }
}

/** Texts and templates back to what the page was written with; the regions detached. */
function prepare(container: Node, ssr: Element, adopt: boolean): void {
  const walk = (parent: Node): void => {
    for (const n of Array.from(parent.childNodes)) {
      // a text marker takes the nodes up to its end with it
      if (n.parentNode !== parent) continue;
      if (n.nodeType === 8) {
        const d = (n as Comment).data;
        // (a mark the server did not write — in a value — that does not parse is left as it is)
        try {
          if (d === "wcs-s") n.parentNode!.removeChild(n);
          else if (d === "wcs-e") n.parentNode!.replaceChild(document.createTextNode(""), n);
          else if (d.startsWith("wcs-t:")) {
            // the value between the markers, back to its mustache
            const text = document.createTextNode(`{{ ${decodeURIComponent(d.slice(6))} }}`);
            let e: Node | null = n.nextSibling;
            while (e !== null && !isMark(e, "wcs-/t")) {
              const next = e.nextSibling;
              e.parentNode!.removeChild(e);
              e = next;
            }
            e?.parentNode!.removeChild(e);
            n.parentNode!.replaceChild(text, n);
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
  holdRegions(container.childNodes, adopt);
}

/**
 * The `adoptScope` hook: a Light DOM component's engine binds its host. Its content is prepared
 * now, and its blocks take the server's nodes while its walk runs (a walk adopts synchronously).
 * What it did not adopt is dropped after the walk; the regions of other engines are left alone.
 */
export function adoptScope(host: Node): (() => void) | null {
  const d = deferred.get(host);
  if (d === undefined) return null;
  deferred.delete(host);
  const before = new Set(held.keys());
  prepare(host, d.ssr, d.adopt);
  if (!d.adopt) return null;
  const prev = hooks.adopt;
  hooks.adopt = adopt;
  return () => {
    hooks.adopt = prev;
    for (const k of Array.from(held.keys())) if (!before.has(k)) held.delete(k);
  };
}

/** The `element` hook, "mounting": a client root with a server snapshot adopts the server's DOM. */
export function hydrate(engine: Engine): void {
  const el = engine.element as Element;
  if (!el.hasAttribute("enable-ssr") || isServer()) return;
  // the server ran $connectedCallback; the client does not, whether or not it adopts
  const e = engine as any;
  const callHook = e.callHook;
  e.callHook = (name: string, args?: unknown[]) => (name === "$connectedCallback" ? undefined : callHook.call(engine, name, args));
  const ssr = el.previousElementSibling;
  if (ssr === null || ssr.localName !== tag()) return;
  const version = ssr.getAttribute("version");
  const same = version === null || majorMinor(version) === majorMinor(VERSION);
  if (!same) console.warn(`[@wcstack/state] <${tag()} version="${version}"> does not match ${VERSION}: the page renders on the client.`);
  const script = ssr.querySelector('script[type="application/json"]');
  if (script !== null) {
    const snap = JSON.parse(script.textContent || "{}") as Record<string, unknown>;
    const target = engine.target;
    for (const key of Object.keys(snap)) {
      const d = Object.getOwnPropertyDescriptor(target, key);
      if (d !== undefined && (d.get !== undefined || d.set !== undefined || typeof d.value === "function")) continue;
      target[key] = snap[key];
    }
    // the snapshot holds the server's volume data too: a volume adopts it (scopes/volume.ts)
    e.hydrated = true;
  }
  const root = el.getRootNode() as Document | ShadowRoot;
  for (const r of Array.from(root.querySelectorAll(`[${RAW_ATTR}]`))) {
    r.textContent = r.getAttribute(RAW_ATTR);
    r.removeAttribute(RAW_ATTR);
  }
  prepare(root.nodeType === 9 ? (root as Document).body : root, ssr, same);
  ssr.remove();
  if (same) {
    hydrating.add(engine);
    // only while a page is adopted: every other block is built with one null check
    hooks.adopt = adopt;
  }
}

/** The `element` hook, "connected": the page is bound — what was not adopted is gone. */
export function hydrated(engine: Engine): void {
  if (!hydrating.has(engine)) return;
  hydrating.delete(engine);
  held.clear();
  hooks.adopt = null;
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
      for (let i = source.length; i-- > 0; ) if (isOuter(source[i].name)) source.splice(i, 1);
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

/** The `adopt` hook: the next server row (or branch) of the view anchored at `anchor`. */
export function adopt(plan: RowPlan, anchor: Node, isFor: boolean): Node | null {
  if (held.size === 0) return null;
  let key = anchor;
  let branch = 0;
  if (!isFor) {
    // only this chain: an `if` anchor starts one (a chain right before or after is another)
    const head = config.commentIfPrefix;
    if (!isMark(anchor, head)) {
      for (let p = anchor.previousSibling; p !== null && (isIfAnchor(p) || (p.nodeType === 3 && (p as Text).data.trim() === "")); p = p.previousSibling) {
        if (isIfAnchor(p)) branch++;
        if (isMark(p, head)) break;
      }
    }
    for (let n = anchor.nextSibling; n !== null && !isMark(n, head) && (isIfAnchor(n) || (n.nodeType === 3 && (n as Text).data.trim() === "")); n = n.nextSibling) {
      if (isIfAnchor(n)) key = n;
    }
  }
  const r = held.get(key);
  if (r === undefined || (!isFor && r.branch !== branch)) return null;
  const nodes = r.rows.shift();
  if (r.rows.length === 0) held.delete(key);
  if (nodes === undefined) return null;
  // siblings again, then the row's own nested regions wait for its nested views
  const frag = document.createDocumentFragment();
  frag.append(...nodes);
  holdRegions(frag.childNodes, true);
  if (frag.childNodes.length !== plan.fragment.childNodes.length) return null;
  // where a binding lands, the server's row has the plan's nodes — not so when a Light DOM element
  // added children before them, or the parser put a <tbody> around a <tr>: then it is rendered anew
  for (const path of plan.nodePaths) {
    let a: Node = plan.fragment;
    let b: Node | undefined = frag;
    for (const i of path) if ((b = b?.childNodes[i])?.nodeName !== (a = a.childNodes[i]).nodeName) return null;
  }
  return plan.single ? frag.firstChild : frag;
}
