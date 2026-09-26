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
import { ForView, type Block, type IfView, type RowPlan } from "../dom/view";
import { config } from "../config";
import { hooks } from "../hooks";

/** The version written by the server and checked (major.minor) by the client: the same build on both sides. */
export const VERSION = "0.0.0";
const TAG = "wcs-ssr";
const BUILDER = Symbol.for("wcstack.ssr.snapshotBuilder");

export const isServer = (): boolean => document.documentElement?.hasAttribute("data-wcs-server") === true;

const mark = (data: string): Comment => document.createComment(data);
const isMark = (n: Node | null, data: string): boolean => n !== null && n.nodeType === 8 && (n as Comment).data === data;
const startsMark = (n: Node | null, prefix: string): boolean => n !== null && n.nodeType === 8 && (n as Comment).data.startsWith(prefix);

// ---------------------------------------------------------------- server

/** Page-level anchors (the walker's) and the template each replaced, by engine. */
const anchors = new WeakMap<Engine, Map<Node, Element>>();

/** Nodes from `from` to `to`, siblings, inclusive. */
function range(from: Node, to: Node): Node[] {
  const out: Node[] = [];
  for (let n: Node | null = from; n !== null; n = n.nextSibling) {
    out.push(n);
    if (n === to) break;
  }
  return out;
}

const lastOf = (b: Block): Node => (b.nodes === null ? b.first : b.nodes[b.nodes.length - 1]);

/** Moves the blocks' nodes right after `after`, as one region. */
function region(after: Node, blocks: Block[], branch: number | null): void {
  const frag = document.createDocumentFragment();
  frag.append(mark(branch === null ? "wcs-[" : `wcs-[:${branch}`));
  for (const b of blocks) {
    if (branch === null) frag.append(mark("wcs-|"));
    frag.append(...range(b.first, lastOf(b)));
  }
  frag.append(mark("wcs-]"));
  after.parentNode!.insertBefore(frag, after.nextSibling);
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

const RAW = new Set(["script", "style", "template", "textarea", "title", TAG]);

/** Keeps every text node a text node through HTML serialization and parsing. */
function protectTexts(parent: Node): void {
  for (const n of Array.from(parent.childNodes)) {
    if (n.nodeType === 3) {
      if ((n as Text).data === "") n.parentNode!.replaceChild(mark("wcs-e"), n);
      else if (n.nextSibling !== null && n.nextSibling.nodeType === 3) n.parentNode!.insertBefore(mark("wcs-s"), n.nextSibling);
    } else if (n.nodeType === 1 && !RAW.has((n as Element).localName)) {
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
  const map = anchors.get(engine) ?? new Map<Node, Element>();
  // the views the page walker made, top down (a nested view's region stays inside its row's)
  const byAnchor = new Map<Node, ForView | IfView>();
  for (const l of engine.rootLists.values()) {
    if (l.view !== null) byAnchor.set(l.view.anchor, l.view);
    if (l.extra !== null) for (const v of l.extra) byAnchor.set(v.anchor, v);
  }
  for (const bs of engine.rootBindings.values()) {
    for (const b of bs) if (b.chain !== null) for (const br of b.chain.branches) byAnchor.set(br.anchor, b.chain);
  }
  const done = new Set<ForView | IfView>();
  for (const anchor of map.keys()) {
    const v = byAnchor.get(anchor);
    if (v !== undefined && !done.has(v) && anchor.isConnected) {
      done.add(v);
      visitView(v);
    }
  }
  const root = el.getRootNode() as Document | ShadowRoot;
  protectTexts(root.nodeType === 9 ? (root as Document).body : root);
  const ssr = document.createElement(TAG);
  ssr.setAttribute("version", VERSION);
  const script = document.createElement("script");
  script.type = "application/json";
  script.textContent = json(data(engine.target));
  ssr.append(script);
  for (const [anchor, template] of map) {
    if (!anchor.isConnected) continue;
    const id = `wcs-t${ids++}`;
    anchor.parentNode!.replaceChild(mark(`wcs-p:${id}`), anchor);
    const t = document.createElement("template");
    t.id = id;
    for (const a of Array.from(template.attributes)) t.setAttribute(a.name, a.value);
    t.content.append(document.importNode((template as HTMLTemplateElement).content, true));
    ssr.append(t);
  }
  el.parentNode!.insertBefore(ssr, el);
}

/** The builder the server calls before it serializes (protocol wcs-ssr-snapshot v1). */
function build(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll(`${config.tagNames.state}[enable-ssr]`))) {
    if (el.hasAttribute("mount") || el.hasAttribute("bind-component")) continue;
    if (el.previousElementSibling?.localName === TAG) continue;
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

/** Detaches the region starting at `start` (its markers included); its rows. */
function detach(start: Comment): Region {
  const m = /^wcs-\[(?::(\d+))?$/.exec(start.data)!;
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
      if (m[1] !== undefined && rows.length === 0) rows.push([]);
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
    } else if (n.nodeType === 1 && !RAW.has((n as Element).localName)) {
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
        if (d === "wcs-s") n.parentNode!.removeChild(n);
        else if (d === "wcs-e") n.parentNode!.replaceChild(document.createTextNode(""), n);
        else if (d.startsWith("wcs-t:")) {
          // the value between the markers, back to its mustache
          let e: Node | null = n.nextSibling;
          while (e !== null && !isMark(e, "wcs-/t")) {
            const next = e.nextSibling;
            e.parentNode!.removeChild(e);
            e = next;
          }
          e?.parentNode!.removeChild(e);
          n.parentNode!.replaceChild(document.createTextNode(`{{ ${decodeURIComponent(d.slice(6))} }}`), n);
        } else if (d.startsWith("wcs-p:")) {
          const t = ssr.querySelector(`template[id="${d.slice(6)}"]`) as HTMLTemplateElement | null;
          if (t !== null) {
            const copy = document.importNode(t, true);
            copy.removeAttribute("id");
            n.parentNode!.replaceChild(copy, n);
          }
        }
      } else if (n.nodeType === 1 && !RAW.has((n as Element).localName)) {
        walk(n);
      }
    }
  };
  walk(container);
  holdRegions(container.childNodes, adopt);
}

const majorMinor = (v: string): string => v.split(".").slice(0, 2).join(".");

/** The `element` hook, "mounting": a client root with a server snapshot adopts the server's DOM. */
export function hydrate(engine: Engine): void {
  const el = engine.element as Element;
  if (!el.hasAttribute("enable-ssr") || isServer()) return;
  // the server ran $connectedCallback; the client does not, whether or not it adopts
  const e = engine as any;
  const callHook = e.callHook;
  e.callHook = (name: string, args?: unknown[]) => (name === "$connectedCallback" ? undefined : callHook.call(engine, name, args));
  const ssr = el.previousElementSibling;
  if (ssr === null || ssr.localName !== TAG) return;
  const version = ssr.getAttribute("version");
  const same = version === null || majorMinor(version) === majorMinor(VERSION);
  if (!same) console.warn(`[@wcstack/state] <${TAG} version="${version}"> does not match ${VERSION}: the page renders on the client.`);
  const script = ssr.querySelector('script[type="application/json"]');
  if (script !== null) {
    const snap = JSON.parse(script.textContent || "{}") as Record<string, unknown>;
    const target = engine.target;
    for (const key of Object.keys(snap)) {
      const d = Object.getOwnPropertyDescriptor(target, key);
      if (d !== undefined && (d.get !== undefined || d.set !== undefined || typeof d.value === "function")) continue;
      target[key] = snap[key];
    }
  }
  const root = el.getRootNode() as Document | ShadowRoot;
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

/** The `ssrMark` hook: on the server, records; on the client, a held region follows its template's anchor. */
export function ssrMark(engine: Engine, node: Node, source: Element | string): void {
  if (isServer()) {
    if (typeof source === "string") {
      node.parentNode!.insertBefore(mark(`wcs-t:${encodeURIComponent(source)}`), node);
      node.parentNode!.insertBefore(mark("wcs-/t"), node.nextSibling);
      return;
    }
    let map = anchors.get(engine);
    if (map === undefined) anchors.set(engine, (map = new Map()));
    map.set(node, source);
    return;
  }
  if (typeof source !== "string" && held.size > 0) {
    const r = held.get(source);
    if (r !== undefined) {
      held.delete(source);
      held.set(node, r);
    }
  }
}

const isIfAnchor = (n: Node | null): boolean => isMark(n, "wcs-if");

/** The `adopt` hook: the next server row (or branch) of the view anchored at `anchor`. */
export function adopt(plan: RowPlan, anchor: Node, isFor: boolean): Node | null {
  if (held.size === 0) return null;
  let key = anchor;
  let branch = 0;
  if (!isFor) {
    for (let p = anchor.previousSibling; p !== null && (isIfAnchor(p) || (p.nodeType === 3 && (p as Text).data.trim() === "")); p = p.previousSibling) {
      if (isIfAnchor(p)) branch++;
    }
    for (let n = anchor.nextSibling; n !== null && (isIfAnchor(n) || (n.nodeType === 3 && (n as Text).data.trim() === "")); n = n.nextSibling) {
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
  if (plan.single) return frag.childNodes.length === 1 ? frag.firstChild : null;
  return frag.childNodes.length === plan.fragment.childNodes.length ? frag : null;
}
