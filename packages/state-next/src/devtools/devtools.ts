/**
 * DevTools (`@wcstack/devtools`) — the DevTools Hook Protocol v2 (docs/devtools-hook-protocol.ja.md),
 * spoken by an add-on so the engine pays nothing while no DevTools is attached.
 *
 * The protocol's pulls (the roster, keys, read, write, keyed subscriptions) read the engines; its
 * events come from the add-on hooks (written, drained, failed, the element lifecycle) and from
 * the tokens, wrapped per engine. Addresses and bindings are small plain objects of the shape
 * DevTools reads (`absolutePathInfo.pathInfo.path`, `listIndex.indexes`, `propName`,
 * `statePathName`, `bindingType`, `node`), built only while a sink is set. Every key that
 * crosses to DevTools is quoted: the build shortens internal names, some of which (`kind`,
 * `path`, `node`, `propName`, …) are also the protocol's.
 *
 * The one part v2 builds from the engine's own bookkeeping — "binding added / removed" — the new
 * engine does not have (row bindings are lazy slots, made on their first change). While DevTools
 * is attached, the add-on takes the list of bindings after every drain (materialized ones and
 * slots alike) and reports the difference: DevTools sees the same live ledger, at a cost paid
 * only then.
 */
import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { StateRow } from "../list";
import type { Token } from "../token";
import { ForView, IfView, K_ATTR, K_CLASS, K_EVENT, K_STYLE, K_TEXT, type Binding, type Block, RowView, type Spec } from "../dom/view";
import { engines as byRoot } from "../dom/mount";
import { VERSION } from "../version";

const HOOK = "__WCSTACK_DEVTOOLS_HOOK__";
const PROTOCOL = 2;

type Sink = (event: Record<string, unknown>) => void;
type Source = Record<string, any>;

let sink: Sink | null = null;
const live = new Set<Engine>();

// ---------------------------------------------------------------- registry (first one wins)

function createRegistry(): Record<string, unknown> {
  const sources = new Map<string, Source>();
  const listeners = new Set<Record<string, (...a: any[]) => void>>();
  const apply = (s: Source): void => {
    if (listeners.size === 0) s["_setSink"](null);
    else s["_setSink"]((event: unknown) => { for (const l of listeners) l["onEvent"]?.(s["id"], event); });
  };
  return {
    "version": PROTOCOL,
    "sources": sources,
    "register"(s: Source): void {
      if (sources.has(s["id"])) return;
      sources.set(s["id"], s);
      apply(s);
      for (const l of listeners) l["onSourceRegistered"]?.(s);
    },
    "unregister"(id: string): void {
      const s = sources.get(id);
      if (s === undefined) return;
      s["_setSink"](null);
      sources.delete(id);
      for (const l of listeners) l["onSourceUnregistered"]?.(id);
    },
    "addListener"(l: Record<string, (...a: any[]) => void>): () => void {
      listeners.add(l);
      for (const s of sources.values()) {
        apply(s);
        l["onSourceRegistered"]?.(s);
      }
      return () => {
        if (listeners.delete(l)) for (const s of sources.values()) apply(s);
      };
    },
  };
}

// ---------------------------------------------------------------- shapes DevTools reads

const address = (engine: Engine, p: Pattern, row: StateRow | null): Record<string, unknown> => ({
  "absolutePathInfo": { "pathInfo": { "path": p.path }, "stateElement": engine.element },
  "listIndex": row === null ? null : { "indexes": engine.indexesOf(row) },
});

function propName(kind: number, name: string): string {
  if (kind === K_TEXT) return "textContent";
  if (kind === K_CLASS) return `class.${name}`;
  if (kind === K_ATTR) return `attr.${name}`;
  if (kind === K_STYLE) return `style.${name}`;
  return name;
}

/** A binding as DevTools reads it: `{ binding, absoluteAddress }`. */
type Entry = Record<string, unknown>;

const nodeIds = new WeakMap<Node, number>();
let nodeSeq = 0;
const idOf = (n: Node): number => {
  let id = nodeIds.get(n);
  if (id === undefined) nodeIds.set(n, (id = ++nodeSeq));
  return id;
};

/** Every binding of the engine now — materialized ones and row slots alike — by identity. */
function snapshot(engine: Engine, old: Map<string, Entry> | undefined): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const seen = new Set<object>();
  const add = (kind: number, name: string, node: Node, p: Pattern, row: StateRow | null, type: string): void => {
    if (kind === K_EVENT) return;
    const prop = propName(kind, name);
    const r = p.depth === 0 ? null : row;
    const key = `${idOf(node)}|${prop}|${p.path}|${r === null ? "" : engine.indexesOf(r).join(",")}`;
    if (out.has(key)) return;
    const kept = old?.get(key);
    out.set(key, kept ?? {
      "binding": { "propName": prop, "statePathName": p.path, "bindingType": type, "node": node, "replaceNode": node },
      "absoluteAddress": address(engine, p, r),
    });
  };
  const binding = (b: Binding): void => add(b.kind, b.name, b.node, b.pattern, b.row, b.typeName());
  const block = (b: Block): void => {
    if (seen.has(b)) return;
    seen.add(b);
    if (b.bindings !== null) for (const x of b.bindings) binding(x);
    if (b instanceof RowView && b.slots !== null) {
      const lazy: Spec[] = b.plan.lazy;
      for (let k = 0; k < lazy.length; k++) {
        const made = b.bound?.[k];
        if (made !== undefined) binding(made);
        else add(lazy[k].kind, lazy[k].name, b.slots[2 * k] as Node, lazy[k].pattern!, b.row, lazy[k].kind === K_TEXT ? "text" : "prop");
      }
    }
    if (b.children !== null) for (const v of b.children) view(v);
  };
  const view = (v: ForView | IfView): void => {
    if (seen.has(v)) return;
    seen.add(v);
    if (v instanceof ForView) {
      // the list binding itself: v2 has one per `for`, on the anchor that replaced the template
      add(-1, "for", v.anchor, v.list.pattern, v.list.parentRow, "for");
      for (const rv of v.rowViews) block(rv);
    } else if (v.current !== null) block(v.current);
  };
  for (const bs of engine.rootBindings.values()) {
    for (const b of bs) {
      binding(b);
      if (b.chain !== null) view(b.chain);
    }
  }
  for (const l of engine.rootLists.values()) {
    if (l.view !== null) view(l.view);
    if (l.extra !== null) for (const v of l.extra) view(v);
  }
  return out;
}

const ledgers = new WeakMap<Engine, Map<string, Entry>>();

/** Reports the bindings added and removed since the last look. */
function sync(engine: Engine): void {
  if (sink === null) return;
  const old = ledgers.get(engine);
  const now = live.has(engine) ? snapshot(engine, old) : new Map<string, Entry>();
  if (old !== undefined) for (const [k, e] of old) if (!now.has(k)) sink({ "type": "state:binding-removed", ...e });
  for (const [k, e] of now) if (old === undefined || !old.has(k)) sink({ "type": "state:binding-added", ...e });
  ledgers.set(engine, now);
}

// ---------------------------------------------------------------- the pulls

function engineOf(root: Node): Engine {
  const e = byRoot.get(root);
  if (e === undefined) throw new Error("[@wcstack/state] devtools: no state tree on this root");
  return e;
}

function summary(engine: Engine): Record<string, unknown> {
  const list = new Set<string>();
  const element = new Set<string>();
  const getter = new Set<string>();
  const setter = new Set<string>();
  for (const p of engine.patterns.all()) {
    for (let k = 1; k <= p.depth; k++) list.add(p.lists[k]!.path);
    if (p.last === "*") element.add(p.path);
    if (p.getter !== null) getter.add(p.path);
    if (p.setter !== null) setter.add(p.path);
  }
  const t = engine.target;
  return {
    "rootNode": engine.root,
    "element": engine.element,
    "paths": { "list": list, "element": element, "getter": getter, "setter": setter },
    "commandTokenNames": new Set(Object.keys(engine.commands)),
    "eventTokenNames": new Set(engine.events.keys()),
    "staticDependency": new Map(),
    "dynamicDependency": new Map(),
    "watchPaths": t.$watch !== null && typeof t.$watch === "object" ? new Set(Object.keys(t.$watch)) : null,
    "keyedListPaths": t.$listKeys !== null && typeof t.$listKeys === "object" ? new Set(Object.keys(t.$listKeys)) : null,
  };
}

function keyedSubscriptions(engine: Engine): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const p of engine.patterns.all()) {
    const subs = p.eqSubs;
    const lists = p.eqIndexWatchers?.length ?? 0;
    if ((subs === null || subs.size === 0) && lists === 0) continue;
    let rows = 0;
    if (subs !== null) for (const s of subs.values()) rows += s.size;
    let lastValue: unknown;
    try { lastValue = p.depth === 0 ? engine.readUntracked(p, null) : undefined; } catch { lastValue = undefined; }
    out.push({ "path": p.path, "tracked": false, "rows": rows, "keys": subs === null ? 0 : subs.size, "lists": lists, "lastValue": lastValue });
  }
  return out;
}

function createSource(): Source {
  return {
    "id": `state:${Math.random().toString(36).slice(2, 10)}`,
    "kind": "state",
    "packageVersion": VERSION,
    "getStateElements": () => [...live].map(summary),
    "overlays": () => [],
    "keyedSubscriptions": (root: Node) => keyedSubscriptions(engineOf(root)),
    "keys"(root: Node): string[] {
      const t = engineOf(root).target;
      return Object.keys(t).filter((k) => {
        if (k.includes("*") || k[0] === "$") return false;
        const d = Object.getOwnPropertyDescriptor(t, k)!;
        return d.get !== undefined || typeof d.value !== "function";
      });
    },
    "read"(root: Node, path: string, indexes?: number[]): unknown {
      const el = engineOf(root).element as any;
      let v: unknown;
      el.createState("readonly", (s: any) => { v = s.$resolve(path, indexes ?? []); });
      return v;
    },
    "write"(root: Node, path: string, value: unknown, indexes?: number[]): void {
      const el = engineOf(root).element as any;
      el.createState("writable", (s: any) => { s.$resolve(path, indexes ?? [], value); });
    },
    "_setSink"(next: Sink | null): void {
      const attached = sink === null && next !== null;
      sink = next;
      // a DevTools that attaches late sees the bindings there already
      if (attached) queueMicrotask(() => { for (const e of live) sync(e); });
    },
  };
}

// ---------------------------------------------------------------- the hooks

const wrapped = new WeakSet<Token>();

function wrapTokens(engine: Engine): void {
  const wrap = (t: Token, kind: "command" | "event"): void => {
    if (wrapped.has(t)) return;
    wrapped.add(t);
    const emit = t.emit;
    t.emit = (...args: unknown[]) => {
      if (sink !== null) sink({ "type": "state:token-emit", "kind": kind, "tokenName": t.name, "args": args, "subscriberCount": t.size, "stateElement": engine.element });
      return emit.apply(t, args);
    };
  };
  for (const t of Object.values(engine.commands)) wrap(t, "command");
  for (const t of engine.events.values()) wrap(t, "event");
}

const batches = new WeakMap<Engine, Set<unknown>>();

export function devtoolsElement(engine: Engine, phase: string): void {
  if (phase === "mounting" || phase === "reset") wrapTokens(engine);
  if (phase === "connected") {
    if (live.has(engine)) return;
    live.add(engine);
    sink?.({ "type": "state:element-registered", "rootNode": engine.root, "element": engine.element });
    sync(engine);
  } else if (phase === "disconnected") {
    live.delete(engine);
    sync(engine);
    sink?.({ "type": "state:element-unregistered", "rootNode": engine.root, "element": engine.element });
  }
}

export function devtoolsWritten(engine: Engine, p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean): void {
  if (sink === null) return;
  const a = address(engine, p, p.depth === 0 ? null : row);
  let batch = batches.get(engine);
  if (batch === undefined) batches.set(engine, (batch = new Set()));
  batch.add(a);
  if (direct) sink({ "type": "state:write", "absoluteAddress": a, "value": value, "oldValue": old, "hasOldValue": true });
}

export function devtoolsDrained(engine: Engine): void {
  if (sink === null) return;
  const batch = batches.get(engine);
  batches.delete(engine);
  if (batch !== undefined) sink({ "type": "state:update-batch", "addresses": batch });
  sync(engine);
}

export function devtoolsFailed(_engine: Engine, error: unknown, b: Binding): void {
  sink?.({ "type": "state:binding-apply-error", "path": b.pattern.path, "bindingType": b.typeName(), "error": error });
}

export function registerSource(): void {
  if (typeof document === "undefined" || document.documentElement?.hasAttribute("data-wcs-server")) return;
  const g = globalThis as any;
  const registry = g[HOOK] ?? (g[HOOK] = createRegistry());
  if (registry["version"] !== PROTOCOL) console.warn(`[@wcstack/state] devtools hook registry version ${registry["version"]}, expected ${PROTOCOL}: keeping the existing one.`);
  registry["register"](createSource());
}
