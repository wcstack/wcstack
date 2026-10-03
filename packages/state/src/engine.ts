import { Pattern, PatternTable, parsePath, WILDCARD, type EqSub } from "./pattern";
import { StateList, StateRow, reconcile, type ReconcileHooks } from "./list";
import type { Strategy } from "./strategy/types";
import type { Binding } from "./dom/view";
import { commandNamespace, eventTokens, type Token } from "./token";
import { runTransition } from "./protocol/transitionRunner";
import { raise, M, text } from "./messages";
import { recursionUnsupported } from "./parser/parseStatePart";
import { hooks, requireFeature } from "./hooks";
import { INDEX_PARAM, MAX_INDEX_PARAM } from "./parser/define";

/** Declarations an add-on serves: without it installed they fail instead of doing nothing. */
const REMOVED_DECLARATIONS: [string, string][] = [["$streams", "$stream"], ["$updatedCallback", "$renderedCallback"]];
const DECLARATIONS: [string, string][] = [["$watch", "temporal"], ["$stream", "temporal"], ["$listKeys", "list-keys"], ["$recursion", "recursion"]];

/**
 * The options of `$behavior` (each true by default): what an engine reads them as is `mustache` / `guard` / `directional`.
 * The tooling manifest publishes the same list (`behaviorOptions`, public/manifest.ts — public-surface.test.ts pins
 * them equal; the manifest does not import the engine).
 */
export const BEHAVIOR_KEYS: readonly string[] = ["enableMustache", "sameValueGuard", "enableDirectionalInitialSync"];

/** `**` binds a depth only where a path is read: an assignment, $resolve, $postUpdate and $dependOn refuse it. */
function unbound(path: string): string {
  if (path.includes("**")) recursionUnsupported(path);
  return path;
}

/** `$1` … `$128`, no leading zero (parser/define.ts — the tooling manifest reads them there too). */
export { INDEX_PARAM, MAX_INDEX_PARAM };

interface Frame {
  getter: Pattern;
  row: StateRow | null;
  untracked: number;
  /** The evaluation this frame runs (`$eq` tells its keys from an earlier evaluation's). */
  epoch: number;
}

/** Getter evaluations so far (each frame takes the next: an evaluation's identity). */
let evals = 0;

/** A `$eq` subscription of a getter occurrence, kept on its row (or the engine, at the root). */
export interface EqEntry {
  source: Pattern;
  key: unknown;
  sub: EqSub;
  epoch: number;
}

/** A drain that keeps producing work this many times in a row is an update loop. */
export const MAX_DRAIN_PASSES = 32;
/**
 * Drains in a row that rendering itself started (an element's write-back, a write in
 * `$renderedCallback`) beyond this many are an update loop (as @wcstack/state 3.3.x).
 */
export const MAX_RENDER_CHAIN = 100;
/** Nested getter evaluations deeper than this are a runaway chain. */
const MAX_GETTER_DEPTH = 128;

export type Visit = (getter: Pattern, row: StateRow | null) => boolean;

/** The value of `k` in `m`, made and set first when there is none (`make`: a shared factory, not a closure per call). */
function upsert<K, V>(m: { get(k: K): V | undefined; set(k: K, v: V): unknown }, k: K, make: () => V): V {
  let v = m.get(k);
  if (v === undefined) m.set(k, (v = make()));
  return v;
}
const newSet = <T>(): Set<T> => new Set<T>();
const newArray = <T>(): T[] => [];

/** A promise, or anything with a then(). */
export function isThenable(r: any): r is PromiseLike<unknown> {
  return r !== null && typeof r === "object" && typeof r.then === "function";
}

/** Map-key equality: Object.is, except +0 and -0 are equal (keys of a Map). */
function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || (a !== a && b !== b);
}

/** Drops a `$eq` subscription; a key nobody waits for any more leaves the map (it may be a row's item). */
function unsubEq(source: Pattern, key: unknown, sub: EqSub): void {
  const set = source.eqSubs?.get(key);
  if (set !== undefined && set.delete(sub) && set.size === 0) source.eqSubs!.delete(key);
}

function dig(v: any, segs: readonly string[]): unknown {
  for (let i = 0; i < segs.length; i++) {
    if (v == null) return undefined;
    v = v[segs[i]];
  }
  return v;
}

/** The row at `depth` on the chain of `row` (itself or an ancestor), or null. */
export function rowAt(row: StateRow | null, depth: number): StateRow | null {
  while (row !== null && row.list.depth > depth) row = row.list.parentRow;
  return row !== null && row.list.depth === depth ? row : null;
}

/** The context row of `p`'s list at depth `k` — null when the context is a row of another list. */
function ctxRow(ctx: StateRow | null, p: Pattern, k: number): StateRow | null {
  const r = rowAt(ctx, k);
  return r !== null && r.list.pattern === p.lists[k] ? r : null;
}

/**
 * One engine per <wcs-state>. It owns everything reachable from its state: the
 * patterns, the lists and their rows, the bindings, the update queue. Nothing is keyed
 * by the state element, because nothing is shared between engines.
 */
export class Engine implements ReconcileHooks {
  target!: Record<string, any>;
  /** `$behavior` (fixed at construction): `{{ }}` text, the same-value guard, direction-aware initial sync. */
  mustache!: boolean;
  guard!: boolean;
  directional!: boolean;
  readonly patterns: PatternTable;
  readonly strategy: Strategy;
  readonly proxy: Record<string, any>;
  /** Number of row-level getter slots. */
  slotCount = 0;
  /** Evaluation context: the row a getter / method / setter runs for. */
  ctx: StateRow | null = null;
  /** Writes throw while > 0: a readonly createState callback, or a getter being evaluated. */
  readonlyDepth = 0;
  /** The node the bindings were mounted on (delegated listeners live here). */
  root: Node | null = null;
  /** Delegated event types → the property (per engine) their element handlers are stored under. */
  private readonly delegated = new Map<string, symbol>();
  /** Property (per engine) on a block's top node(s) holding the block, for delegated events. */
  readonly blockKey = Symbol("wcs.block");
  /** The <wcs-state> element (`this.$stateElement`). */
  element: unknown = null;
  /**
   * A mounted component's (scopes add-on): a function read off the proxy itself, made to run on it
   * when called detached — the proxy is `element.state`, and `const { toggle } = element.state`
   * works (3.x #331). Undefined (or no answer): as it is.
   */
  declare bound?: (fn: (...args: any[]) => unknown) => unknown;
  /** `$command`: the command tokens declared in `$commandTokens`. */
  commands!: Readonly<Record<string, Token>>;
  /** The event tokens declared in `$eventTokens`, with the `$on` handlers subscribed. */
  events!: Map<string, Token>;
  /** Binding failures of the current drain, reported after it (`$errorCallback` or console). */
  private errors: [unknown, Binding][] = [];
  /** Paths applied in the current drain, for `$renderedCallback` (collected only when declared). */
  rendered: Map<string, number[][]> | null = null;
  private frames: Frame[] = [];
  private depthNow = 0;
  private top: Frame | null = null;
  readonly rootLists = new Map<Pattern, StateList>();
  readonly rootBindings = new Map<Pattern, Set<Binding>>();
  private queue: Binding[] = [];
  private dirtyLists: StateList[] = [];
  /** Lists over a changed getter, re-synced at the start of the next drain pass. */
  private staleLists: StateList[] = [];
  private scheduled = false;
  private draining = false;
  /** The lists over each array (only while more than one list has it do writes mirror). */
  private readonly listsByArray = new WeakMap<unknown[], StateList[]>();
  /** Drains in a row that rendering started (MAX_RENDER_CHAIN); a pause between tasks ends it. */
  private chain = 0;
  /**
   * For the drain the write-backs of an apply an arbiter deferred start: its place in that apply's
   * chain (0: none). The pause before the apply ends the task's chain, not this one. Only what the
   * apply writes synchronously is carried: an async `$renderedCallback` writing after an `await`
   * starts a task chain again, so such a loop runs one lap per arbiter task and is never cut.
   */
  private carried = 0;
  /** This chain was reported as not settling within a drain (#11): reported once a chain. */
  private unsettled = false;
  /** Since the last drain started: a write rendering fed back / a write from code (which ends a chain). */
  private fedBack = false;
  private codeWrote = false;
  /**
   * Inside `$renderedCallback` (until an async one settles) or a `$watch` handler: its writes are
   * reactions, fed back like an element's (MAX_RENDER_CHAIN).
   */
  feeding = 0;
  private readonly unchainFn = () => {
    this.chain = 0;
    this.unsettled = false;
  };
  private readonly renderedFn = () => {
    this.feeding--;
  };
  // out-parameters of resolve()
  private rp: Pattern | null = null;
  private rr: StateRow | null = null;

  private readonly drainFn = () => this.drain();
  private readonly deliverFn = (handler: (...a: unknown[]) => unknown, args: unknown[]) => handler(this.proxy, ...args);
  /** `$eq` subscriptions of root-level getters. */
  private readonly rootEqSubs: EqEntry[] = [];
  /** The `$` functions of the state (`this.$eq`, …), by name. */
  private readonly api: Record<string, unknown> = {
    $untracked: (fn: () => unknown) => {
      const f = this.top;
      if (f === null) return fn();
      f.untracked++;
      try {
        return fn();
      } finally {
        f.untracked--;
      }
    },
    $eqIndex: (path: string, level = 1) => {
      const row = rowAt(this.ctx, level);
      if (row === null) raise(M.EqIndexNoRow, [path]);
      const source = this.pattern(path);
      // a getter (or a path under one) changes without a write: an ordinary tracked read, and the
      // row's index is read as `$1` reads it (a moved row compares again)
      if (source.getter !== null || source.underGetter) {
        this.watchIndex(level);
        return row.index === this.read(source, null);
      }
      const f = this.top;
      if (f !== null) {
        const g = f.getter;
        const watchers = source.eqIndexWatchers ?? (source.eqIndexWatchers = []);
        if (!watchers.some((w) => w.getter === g && w.level === level)) {
          watchers.push({ getter: g, level });
          const listP = g.lists[level]!;
          (listP.eqIndexKeys ?? (listP.eqIndexKeys = [])).push({ source, getter: g });
        }
      }
      return row.index === this.readUntracked(source, null);
    },
    $eq: (path: string, key: unknown) => this.eq(path, key),
    $eqPath: (path: string, keyPath: string) => {
      const kp = this.pattern(keyPath);
      return this.eq(path, this.readUntracked(kp, rowAt(this.ctx, kp.depth)));
    },
    $dependOn: (path: string) => {
      this.resolve(unbound(path), this.ctx);
      if (this.top !== null && this.top.untracked === 0) this.track(this.rp!, this.rr, this.top);
    },
    $getAll: (path: string, indexes?: number[]) => this.getAll(path, indexes),
    $setAll: (path: string, indexes: number[], value: unknown, options?: { spread?: boolean }) =>
      this.setAll(path, indexes, value, options),
    // $resolve(path, indexes) reads; $resolve(path, indexes, value) writes (the argument count decides)
    $resolve: (...args: unknown[]) => {
      const path = unbound(args[0] as string);
      const indexes = (args[1] ?? []) as number[];
      const p = this.pattern(path);
      this.checkArity("$resolve", path, p, indexes, true);
      const row = this.rowOf(p, indexes, null);
      if (args.length < 3) return this.read(p, row);
      this.write(p, row, args[2]);
    },
    $postUpdate: (path: string) => {
      this.resolve(unbound(path), this.ctx);
      const p = this.rp!;
      const row = this.rr;
      // changed in place: an element is what its array holds now
      if (p.last === WILDCARD && row !== null) {
        row.item = row.list.arr![row.index];
        this.strategy.resetRow(row);
      }
      this.touched(p, row);
      if (row !== null && row.list.shared) this.mirror(row, p, undefined, row.item, false);
      // the value before is not known: the `$eq` / `$eqIndex` occurrences under every key change
      if (p.depth === 0) this.rekeyEqUnder(p, undefined, undefined, true);
      this.landed(p, row, undefined, undefined, false);
    },
  };

  constructor(target: Record<string, any>, strategy: Strategy) {
    this.strategy = strategy;
    this.patterns = new PatternTable((p) => this.onPatternCreated(p));
    this.loadTarget(target);
    const engine = this;
    // the handler reads engine.target, not the proxy's target: a re-set swaps the state
    this.proxy = new Proxy(target, {
      get(_t, key, receiver) {
        const t = engine.target;
        if (typeof key === "symbol") return Reflect.get(t, key);
        if (key.charCodeAt(0) === 36 /* $ */) return engine.dollar(key);
        if (key.indexOf(".") < 0) {
          const p = engine.patterns.peek(key);
          if (p === undefined || p.getter === null) {
            const v = t[key];
            // (a view of the proxy — the readonly createStateAsync's — gets it as it is)
            if (typeof v === "function") return (receiver === engine.proxy && engine.bound?.(v)) || v;
          }
          // a known top-level key: no path to parse
          if (p !== undefined && p.depth === 0) return engine.read(p, null);
        }
        engine.resolve(key, engine.ctx);
        return engine.read(engine.rp!, engine.rr);
      },
      set(_t, key, value) {
        if (typeof key === "symbol") return Reflect.set(engine.target, key, value);
        engine.resolve(unbound(key), engine.ctx);
        engine.write(engine.rp!, engine.rr, value);
        return true;
      },
    });
  }

  // ---------------------------------------------------------------- patterns

  pattern(path: string): Pattern {
    return this.patterns.get(path);
  }

  private registerAccessors(target: object): void {
    const seen = new Set<string>();
    for (let o: object | null = target; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const key of Object.getOwnPropertyNames(o)) {
        if (seen.has(key)) continue;
        seen.add(key);
        const d = Object.getOwnPropertyDescriptor(o, key)!;
        if (d.get === undefined && d.set === undefined) continue;
        const p = this.pattern(key);
        p.getter = d.get ?? null;
        p.setter = d.set ?? null;
        if (p.getter !== null && p.depth > 0) p.slot = this.slotCount++;
      }
    }
    // accessors registered after their descendants were created: recompute
    for (const p of this.patterns.all()) this.onPatternCreated(p);
  }

  private onPatternCreated(p: Pattern): void {
    // (the recursion add-on makes its `**` templates without this, while the state registers)
    if (p.path.includes("**")) recursionUnsupported(p.path);
    // a path through an object's prototype would read and write every object's (once per path)
    if (p.last === "__proto__" || p.last === "prototype") raise(M.UnsafeSegment, [p.path]);
    const parent = p.parent;
    p.underGetter = parent !== null && p.last !== WILDCARD && parent.depth === p.depth &&
      (parent.getter !== null || parent.underGetter);
    if (p.getter === null) this.markupAccessor(p);
  }

  /**
   * Markup names two things the tree does not hold, as `this[...]` reads them: an explicit index
   * (`items.0.v`, the row at that index now) and a loop index (`items.*.$1`, `$1` in a row).
   * Their patterns (only markup makes them: the proxy parses an index into a row) read — and an
   * index path writes — through the proxy, so the reads are tracked like a getter's.
   */
  private markupAccessor(p: Pattern): void {
    const path = p.path;
    const last = p.last;
    if (INDEX_PARAM.test(last)) {
      p.getter = function (this: any) {
        return this[last];
      };
    } else {
      const segs = path.split(".");
      // (a leading numeric segment is a root key, not an index: parsePath)
      const i = segs.findIndex((s, j) => j > 0 && s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57);
      // none, or a `*` after it: a row of a list over the index path (`for: groups.0.items`) reads its
      // own item, and a write through the index reaches it as a list with the same array (mirror)
      if (i < 0 || segs.indexOf(WILDCARD, i) >= 0) return;
      const container = segs.slice(0, i).join(".");
      const rest = segs.slice(i);
      p.getter = function (this: any) {
        const v = this[path];
        if (v !== undefined) return v;
        // not a list there (an object with numeric keys): the path read literally, as 3.3's markup did
        return dig(this[container], rest);
      };
      p.setter = function (this: any, v: unknown) {
        this[path] = v;
      };
    }
    if (p.depth > 0) p.slot = this.slotCount++;
  }

  // ---------------------------------------------------------------- lists

  /** The list of list pattern `p` in `row` (null: a root list), made on first use, synced. */
  childList(row: StateRow | null, p: Pattern): StateList {
    const m = row === null ? this.rootLists : (row.children ??= new Map());
    let l = m.get(p);
    if (l === undefined) m.set(p, (l = new StateList(p, row)));
    this.sync(l);
    return l;
  }

  /** Syncs `l`; a failure (a missing key, a getter that throws) is its for binding's, and it keeps its rows. */
  private trySync(l: StateList): void {
    try {
      this.sync(l);
    } catch (error) {
      this.failAt(error, l.pattern.path, l.view?.anchor ?? null, "for");
    }
  }

  /** Reconciles a list's rows with the current value of its pattern. */
  sync(l: StateList): void {
    const value = this.readUntracked(l.pattern, l.parentRow);
    const before = l.arr;
    if (value === before) return;
    l.was = before;
    // out of the lists over its array before (filed again under the new one below)
    this.unfile(l);
    const old = reconcile(l, value, this);
    if (old === null) return;
    // filed under its array: lists that share an array mirror writes
    // (a value that is not an array reconciles against a stand-in: nothing to share)
    if (l.arr === value) {
      const same = upsert(this.listsByArray, value as unknown[], newArray<StateList>);
      same.push(l);
      if (same.length > 1) {
        for (const x of same) x.shared = true;
        // joining a list that did not share our array before (a getter back from a copy to the
        // array it filters): the rows we kept missed the writes made through it, so they are
        // shown again as if written (F26 — the moves of lists that change arrays together cost nothing)
        if (same.some((x) => x.was !== before)) {
          const e = this.pattern(`${l.pattern.path}.*`);
          for (const r of old) if (r.alive) this.changed(e, r);
        }
      }
    }
    hooks.listSynced?.(this, l, old);
    if ((l.view !== null || l.extra !== null) && !l.queued) {
      l.queued = true;
      this.dirtyLists.push(l);
      this.schedule();
    }
    const keys = l.pattern.eqIndexKeys;
    if (keys !== null) {
      for (const { source, getter } of keys) {
        const sel = this.readUntracked(source, null) as number;
        const before = old[sel];
        const after = l.rows[sel];
        if (before === after) continue;
        if (before !== undefined && before.alive) this.invalidateUnder(getter, before);
        if (after !== undefined) this.invalidateUnder(getter, after);
      }
    }
  }

  indexChanged(row: StateRow): void {
    this.strategy.onIndexChange(this, row);
  }

  rowRemoved(row: StateRow): void {
    row.alive = false;
    const subs = row.eqSubs;
    if (subs !== null) {
      for (const e of subs) unsubEq(e.source, e.key, e.sub);
      row.eqSubs = null;
    }
    // the rows of its nested lists go with it, and the lists leave the ledger of their arrays
    if (row.children !== null) {
      for (const l of row.children.values()) {
        this.unfile(l);
        for (const r of l.rows) this.rowRemoved(r);
      }
    }
  }

  /** Takes `l` out of the lists over its array; one left alone with it no longer mirrors. */
  private unfile(l: StateList): void {
    const was = this.listsByArray.get(l.arr!);
    if (was === undefined) return;
    was.splice(was.indexOf(l) >>> 0, 1);
    l.shared = false;
    if (was.length === 1) was[0].shared = false;
  }

  // ---------------------------------------------------------------- resolve / read

  /** Splits a concrete path into (pattern, row) — written to this.rp / this.rr. */
  resolve(path: string, ctx: StateRow | null): void {
    const parsed = parsePath(path);
    const p = this.pattern(parsed.pattern);
    const idx = parsed.indexes;
    this.rr = p.depth === 0 ? null : idx === null ? ctxRow(ctx, p, p.depth) : this.rowOf(p, idx, ctx);
    // set last: finding the row can sync a list over a getter, whose evaluation resolves paths too
    this.rp = p;
  }

  /** The row at p.depth addressed by `idx` (one index per `*`; -1 takes the one of `ctx`). */
  private rowOf(p: Pattern, idx: readonly number[], ctx: StateRow | null): StateRow | null {
    let row: StateRow | null = null;
    for (let k = 1; k <= p.depth; k++) {
      const listP = p.lists[k]!;
      const list = this.childList(row, listP);
      let i = idx[k - 1];
      if (i === -1) i = ctxRow(ctx, p, k)?.index ?? -1;
      row = list.rows[i] ?? null;
      if (row === null) break;
    }
    return row;
  }

  /** Raw data read (no getter, no tracking). `row` is the row at p.depth. */
  readData(p: Pattern, row: StateRow | null): unknown {
    return p.depth === 0 ? dig(this.target, p.tail) : row === null ? undefined : dig(row.item, p.tail);
  }

  /** Tracked read. `row` is the row at p.depth (null at the root). */
  read(p: Pattern, row: StateRow | null): unknown {
    const f = this.top;
    if (f !== null && f.untracked === 0) this.track(p, row, f);
    if (p.getter !== null) return this.strategy.readGetter(this, p, row);
    if (p.underGetter) {
      const parent = this.read(p.parent!, row) as any;
      return parent == null ? undefined : parent[p.last];
    }
    // (`then` / `toJSON` are probes — await, JSON.stringify — not reads of the state: undefined)
    if (p.parent === null && !(p.last in this.target) && p.last !== "then" && p.last !== "toJSON") {
      raise(M.PathMissing, [p.path], p.last, Object.keys(this.target));
    }
    return this.readData(p, row);
  }

  readUntracked(p: Pattern, row: StateRow | null): unknown {
    const f = this.top;
    if (f === null) return this.read(p, row);
    f.untracked++;
    try {
      return this.read(p, row);
    } finally {
      f.untracked--;
    }
  }

  private track(p: Pattern, row: StateRow | null, f: Frame): void {
    const g = f.getter;
    p.addDependent(g);
    if (p.depth > 0 && g.depth > 0 && rowAt(row, Math.min(p.depth, g.depth)) !== rowAt(f.row, Math.min(p.depth, g.depth))) {
      (g.crossSources ?? (g.crossSources = new Set())).add(p);
    }
  }

  /** Evaluates a getter occurrence with dependency tracking. Caching is the strategy's. */
  evalGetter(g: Pattern, row: StateRow | null): unknown {
    // frames are reused by depth: an evaluation allocates nothing of its own
    for (let i = 0; i < this.depthNow; i++) {
      const f = this.frames[i];
      if (f.getter === g && f.row === row) raise(M.GetterCycle, [g.path]);
    }
    if (this.depthNow >= MAX_GETTER_DEPTH) raise(M.GetterDepth, [g.path]);
    const depth = this.depthNow++;
    this.readonlyDepth++;
    const frame = (this.frames[depth] ??= { getter: g, row, untracked: 0, epoch: 0 });
    frame.getter = g;
    frame.row = row;
    frame.untracked = 0;
    frame.epoch = ++evals;
    const outer = this.top;
    this.top = frame;
    const prev = this.ctx;
    this.ctx = row;
    try {
      return g.getter!.call(this.proxy);
    } finally {
      this.readonlyDepth--;
      this.depthNow--;
      this.top = outer;
      this.ctx = prev;
      frame.row = null;
    }
  }

  /** The getter evaluating now reads the index of its row at level `n`: a move of that row re-evaluates it. */
  private watchIndex(n: number): void {
    const f = this.top;
    if (f !== null && f.untracked === 0) {
      const g = f.getter;
      const listP = g.lists[n];
      if (listP) {
        const w = listP.indexWatchers ?? (listP.indexWatchers = []);
        if (!w.includes(g)) w.push(g);
      }
    }
  }

  private dollar(key: string): unknown {
    const c = key.charCodeAt(1);
    if (c >= 48 && c <= 57) {
      const n = key.length === 2 ? c - 48 : INDEX_PARAM.test(key) ? +key.slice(1) : 0;
      if (n < 1 || n > MAX_INDEX_PARAM) {
        raise(M.IndexParamRange, [key]);
      }
      this.watchIndex(n);
      return rowAt(this.ctx, n)?.index;
    }
    const fn = this.api[key];
    if (fn !== undefined) return fn;
    switch (key) {
      // 3.2 renamed these; 4.0 removed the old names
      case "$trackDependency":
        return raise(M.ApiRemoved, [key, "$dependOn"]);
      case "$untrackDependency":
        return raise(M.ApiRemoved, [key, "$untracked"]);
      case "$stateElement":
        return this.element;
      case "$command":
        return this.commands;
    }
    return hooks.dollar?.(this, key);
  }

  /**
   * `$eq(path, key)`: is the value of `path` equal to `key`? Inside a getter the occurrence
   * subscribes under `key` instead of depending on `path`: a write to `path` re-evaluates
   * only the occurrences keyed under its old and its new value. A `path` that is a getter
   * (or under one) changes without a write, so it falls back to an ordinary tracked read.
   */
  private eq(path: string, key: unknown): boolean {
    this.resolve(path, this.ctx);
    const source = this.rp!;
    const row = this.rr;
    if (source.getter !== null || source.underGetter || source.depth > 0) return sameValueZero(this.read(source, row), key);
    const f = this.top;
    if (f !== null && f.untracked === 0) this.subscribeEq(source, key, f);
    return sameValueZero(this.readUntracked(source, null), key);
  }

  /**
   * Subscribes the occurrence evaluating in `f` under `key`. A key it subscribed in an earlier
   * evaluation and not in this one moved; one of this evaluation stays (`$eq(p, a) || $eq(p, b)`).
   */
  private subscribeEq(source: Pattern, key: unknown, f: Frame): void {
    const getter = f.getter;
    const row = f.row;
    const list = row === null ? this.rootEqSubs : (row.eqSubs ?? (row.eqSubs = []));
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.sub.getter !== getter || e.source !== source) continue;
      if (sameValueZero(e.key, key)) {
        e.epoch = f.epoch;
        return;
      }
      if (e.epoch !== f.epoch) {
        unsubEq(source, e.key, e.sub);
        list.splice(i--, 1);
      }
    }
    const sub: EqSub = { getter, row };
    upsert((source.eqSubs ??= new Map()), key, newSet<EqSub>).add(sub);
    list.push({ source, key, sub, epoch: f.epoch });
  }

  /**
   * A root write to `p` (or an object above a `$eq` / `$eqIndex` source): re-key every source at or
   * under it. `all` (`$postUpdate`, which knows no value before): every key.
   */
  private rekeyEqUnder(p: Pattern, before: unknown, after: unknown, all?: boolean): void {
    this.forSubtree(p, (q) => {
      const map = q.eqSubs;
      if (map === null && q.eqIndexWatchers === null) return;
      const rest = q === p ? [] : q.path.slice(p.path.length + 1).split(".");
      const b = dig(before, rest);
      const a = dig(after, rest);
      if (q.eqIndexWatchers !== null) this.rekeyEqIndex(q, b, a, all);
      // the occurrences keyed under the value before and the value after
      if (map !== null) for (const k of all ? map.keys() : [b, a]) {
        const set = map.get(k);
        if (set === undefined) continue;
        for (const sub of set) {
          if (sub.row !== null && !sub.row.alive) {
            unsubEq(q, k, sub);
            continue;
          }
          this.strategy.invalidate(this, sub.getter, sub.row);
        }
      }
    });
  }

  // ---------------------------------------------------------------- write

  /**
   * `occurrence`: an event-semantics write, applied even when equal to the current value.
   * `element`: an element wrote it back (a two-way input, a wc-bindable event), not code.
   */
  write(p: Pattern, row: StateRow | null, value: unknown, occurrence = false, element = false): void {
    if (this.readonlyDepth > 0) raise(M.Readonly);
    if (element || this.feeding > 0) this.fedBack = true;
    else this.codeWrote = true;
    if (hooks.beforeWrite?.(this, p, row, value, element)) return;
    // a setter's write is not a data write: the add-ons hear of it without old and new values
    if (p.setter !== null) {
      // a setter that throws after it wrote: what it wrote still lands (3.x #361), and the error
      // propagates. One that throws before writing anything lands as well, as one that returns
      // without writing does (3.x notifies in `finally` too): `$watch` hears of it, a getter recomputes
      try {
        this.callAt(p.setter, row, [value]);
      } finally {
        this.landed(p, row, undefined, undefined, false);
      }
      return;
    }
    if (p.getter !== null) raise(M.GetterWithoutSetter, [p.path]);
    if (p.depth > 0 && row === null) raise(M.NoRow, [p.path]);
    // under a getter, the value before is read through it (the data has no such path)
    const old = p.underGetter ? this.readUntracked(p, row) : this.readData(p, row);
    if (!occurrence && this.guard && Object.is(old, value) && Object(value) !== value) return;
    if (p.last === WILDCARD) {
      // element write: the position keeps its row, the row takes the new value
      const r = row!;
      (r.list.arr as unknown[])[r.index] = value;
      r.item = value;
      this.strategy.resetRow(r);
    } else {
      const parent = (p.tail.length === 1
        ? (p.depth === 0 ? this.target : row!.item)
        : this.readUntracked(p.parent!, row)) as any;
      if (parent == null) raise(M.ParentNotObject, [p.path, parent]);
      parent[p.last] = value;
    }
    this.syncListsUnder(p, row);
    if (row !== null && row.list.shared) this.mirror(row, p, old, value);
    if (p.depth === 0) this.rekeyEqUnder(p, old, value);
    this.landed(p, row, old, value, true);
  }

  /** The lists over `l`'s array now (`l` among them), none of a removed row. */
  private sharing(l: StateList): StateList[] {
    return (this.listsByArray.get(l.arr!) ?? []).filter((m) => m.arr === l.arr && (m.parentRow === null || m.parentRow.alive));
  }

  /**
   * A write into row `row` of a list whose array another list has too (`for: shown` over a getter
   * returning `todos`, `for: groups.0.items`): the other list's row at the same position shows it.
   */
  private mirror(row: StateRow, p: Pattern, old: unknown, value: unknown, direct = true): void {
    const l = row.list;
    const suffix = p.path.slice(l.pattern.path.length + 2);
    for (const m of this.sharing(l)) {
      if (m === l) continue;
      const r = m.rows[row.index];
      if (r === undefined) continue;
      const mp = this.pattern(`${m.pattern.path}.*${suffix}`);
      if (suffix === "") {
        r.item = value;
        this.strategy.resetRow(r);
      }
      if (direct) this.syncListsUnder(mp, r);
      else this.touched(mp, r);
      this.landed(mp, r, old, value, direct);
    }
  }

  /**
   * `$postUpdate`: what is at `p` changed in place. Its lists are synced as a write syncs them, and
   * their rows (and the rows of the lists over the same arrays) show it again: a write reaches a
   * row's bindings through the row it replaced, an in-place change through none.
   */
  private touched(p: Pattern, row: StateRow | null): void {
    this.forListsUnder(p, row, (l) => {
      this.sync(l);
      for (const m of l.shared ? this.sharing(l) : [l]) {
        const e = this.pattern(`${m.pattern.path}.*`);
        for (const r of m.rows) {
          this.enqueueBound(e, r);
          this.touched(e, r);
        }
      }
    });
  }

  private syncListsUnder(p: Pattern, row: StateRow | null): void {
    const ls = row === null ? this.rootLists : row.children;
    if (ls !== null) for (const l of ls.values()) if (l.pattern.isUnder(p)) this.sync(l);
  }

  /** The lists of `row` (the root lists at null) whose pattern is `p` or under it. */
  private forListsUnder(p: Pattern, row: StateRow | null, fn: (l: StateList) => void): void {
    const ls = row === null ? this.rootLists : row.children;
    if (ls !== null) for (const l of ls.values()) if (l.pattern.isUnder(p)) fn(l);
  }

  /**
   * `$eqIndex(source, level)` compares the index of the row at `level`: when `source` changes, the
   * getter's occurrences under the rows at that level with the old or the new index change (`all`:
   * under every row).
   */
  private rekeyEqIndex(source: Pattern, before: unknown, after: unknown, all?: boolean): void {
    for (const { getter, level } of source.eqIndexWatchers!) {
      this.forAllLists(getter.lists[level]!, (l) => {
        for (const k of all ? l.rows.keys() : [before, after]) {
          const r = typeof k === "number" ? l.rows[k] : undefined;
          if (r !== undefined) this.invalidateUnder(getter, r);
        }
      });
    }
  }

  /** Invalidates getter `g`'s occurrences at or under `row` (row.depth <= g.depth). */
  private invalidateUnder(g: Pattern, row: StateRow): void {
    if (row.list.depth === g.depth) this.strategy.invalidate(this, g, row);
    else this.forRowsUnder(row, g, (r) => this.strategy.invalidate(this, g, r));
  }

  /** A write landed at (p, row): the add-ons hear of it, then its dependents. */
  private landed(p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean): void {
    hooks.written?.(this, p, row, old, value, direct);
    this.changed(p, row);
  }

  changed(p: Pattern, row: StateRow | null): void {
    this.strategy.onWrite(this, p, row);
    this.schedule();
  }

  /**
   * One listener per event type on the root, dispatching to the delegated element handlers.
   * Returns the property the element's handler is stored under (one symbol per engine and
   * type, so two engines never run each other's handlers).
   */
  delegate(type: string): symbol {
    const known = this.delegated.get(type);
    if (known !== undefined) return known;
    const key = Symbol(`wcs.on${type}`);
    this.delegated.set(type, key);
    const root = this.root!;
    const blockKey = this.blockKey;
    root.addEventListener(type, (e) => {
      for (let n = e.target as any; n !== null && n !== root; n = n.parentNode) {
        // a handler stored on the element (a root-level one, or one a block pinned)
        const fn = n[key];
        if (fn !== undefined) {
          fn(e);
          if (e.cancelBubble) return;
        }
        // a block's top node: the handlers of the block's elements the event passed
        const block = n[blockKey];
        if (block !== undefined && block.alive && block.dispatch(type, e)) return;
      }
    });
    return key;
  }

  // ---------------------------------------------------------------- re-set

  /**
   * `setInitialState` on an initialized element: the state is replaced whole and every
   * binding is re-applied to it before this returns. Not a write: no `$renderedCallback`.
   * Everything learned from the old state goes (accessors, dependencies, caches, `$eq`
   * keys); rows are kept where their list's array is the same instance.
   */
  reset(target: Record<string, any>): void {
    this.loadTarget(target);
    for (const bs of this.rootBindings.values()) for (const b of bs) this.enqueue(b);
    for (const l of this.rootLists.values()) this.resetList(l);
    this.rendered = null;
    try {
      this.drain();
    } finally {
      this.watchRendered();
    }
    hooks.element?.(this, "reset");
  }

  /** Takes in a state object: at construction, and on a re-set (everything learned from the old one goes). */
  private loadTarget(target: Record<string, any>): void {
    for (const [key, feature] of DECLARATIONS) if (target[key] !== undefined) requireFeature(feature, key);
    if (target.$scan !== undefined) raise(M.ScanRemoved);
    // 3.2 renamed these; 4.0 removed the old names (a declaration under one would do nothing)
    for (const [old, name] of REMOVED_DECLARATIONS) if (target[old] !== undefined) raise(M.DeclarationRemoved, [old, name]);
    const f = target.$features;
    if (f !== undefined) {
      if (!Array.isArray(f)) raise(M.FeaturesNotArray);
      for (const name of f) requireFeature(name, "$features");
    }
    // an options object: null and an array are not one (as for bootstrapState's options)
    const c = target.$behavior === undefined ? {} : target.$behavior;
    if (typeof c !== "object" || !c || Array.isArray(c)) raise(M.OptionInvalid, ["state", "$behavior"]);
    for (const key in c) if (!BEHAVIOR_KEYS.includes(key) || typeof c[key] !== "boolean") raise(M.OptionInvalid, ["$behavior", key]);
    const [mustache, guard, directional] = BEHAVIOR_KEYS.map((key) => c[key] ?? true);
    // a re-set keeps the engine, and what was built by the old options
    if (this.target !== undefined && (mustache !== this.mustache || guard !== this.guard || directional !== this.directional)) raise(M.BehaviorChanged);
    // (read before anything is taken in: a malformed declaration leaves a re-set's old state in place)
    const commands = commandNamespace(target, this.commands);
    const events = eventTokens(target, this.deliverFn);
    this.mustache = mustache;
    this.guard = guard;
    this.directional = directional;
    hooks.declare?.(this, target);
    this.target = target;
    this.slotCount = 0;
    for (const p of this.patterns.all()) p.forget();
    this.rootEqSubs.length = 0;
    this.registerAccessors(target);
    this.commands = commands;
    this.events = events;
  }

  private resetList(l: StateList): void {
    // a list whose key the new state lacks fails alone: the re-set goes on (and ends with its hook)
    this.trySync(l);
    const element = this.pattern(`${l.pattern.path}.*`);
    for (const row of l.rows) {
      row.cache = null;
      row.eqSubs = null;
      this.enqueueBound(element, row);
      if (row.children !== null) for (const c of row.children.values()) this.resetList(c);
    }
  }

  // ---------------------------------------------------------------- tokens

  /** The loop indexes of `row`, outermost first (`$1`, `$2`, …). */
  indexesOf(row: StateRow | null): number[] {
    const out: number[] = [];
    for (let r = row; r !== null; r = r.list.parentRow) out.unshift(r.index);
    return out;
  }

  /** An element event wired with `eventToken.<prop>: <name>` — the token is resolved at fire time. */
  fireEventToken(name: string, event: Event, row: StateRow | null): void {
    const token = this.events.get(name);
    if (token === undefined) raise(M.EventTokenUndeclared, [name], name, this.events.keys());
    token.emit(event, ...this.indexesOf(row));
  }

  /** The `$command.<name>` token (declared in `$commandTokens`). */
  command(name: string): Token {
    const token = this.commands[name];
    if (token === undefined) raise(M.CommandTokenUndeclared, [name], name, Object.keys(this.commands));
    return token;
  }

  /** `onclick: $command.<name>` — emits the token with (event, ...listIndexes). */
  emitCommand(name: string, event: Event, row: StateRow | null): void {
    this.command(name).emit(event, ...this.indexesOf(row));
  }

  // ---------------------------------------------------------------- methods

  invoke(name: string, event: Event, row: StateRow | null): unknown {
    // a dotted name is a path (a volume method lives under its mount path)
    const fn = name.includes(".") ? this.readUntracked(this.pattern(name), null) : this.target[name];
    if (typeof fn !== "function") raise(M.NotAMethod, [name]);
    return this.callAt(fn, row, [event, ...this.indexesOf(row)]);
  }

  /** Calls `fn` on the proxy with the evaluation context at `row`. */
  private callAt(fn: (...args: any[]) => unknown, row: StateRow | null, args: unknown[]): unknown {
    const prev = this.ctx;
    this.ctx = row;
    try {
      return fn.apply(this.proxy, args);
    } finally {
      this.ctx = prev;
    }
  }

  // ---------------------------------------------------------------- change walk

  /** Queues the bindings on `p` (and patterns under it) in the scope of `row`. */
  enqueueBound(p: Pattern, row: StateRow | null): void {
    // a list over a getter (or under one) is re-synced in the drain: a data write syncs its
    // lists right away, but a getter's value is only known when it is read again
    if (p.getter !== null) {
      const ls = row === null ? this.rootLists : row.children;
      if (ls !== null) {
        for (const l of ls.values()) {
          if (!l.stale && l.pattern.isUnder(p)) {
            l.stale = true;
            this.staleLists.push(l);
          }
        }
      }
    }
    if (row === null) {
      this.forSubtree(p, (q) => {
        const bs = this.rootBindings.get(q);
        if (bs !== undefined) for (const b of bs) this.enqueue(b);
      });
      return;
    }
    const bs = row.bindings;
    if (bs !== null) for (let i = 0; i < bs.length; i++) if (bs[i].pattern.isUnder(p)) this.enqueue(bs[i]);
    // slot bindings of the row's renderings
    const view = row.view;
    if (view !== null && view.slots !== null) view.enqueueSlots(this, p);
    const extra = row.list.extra;
    if (extra !== null) {
      for (const fv of extra) {
        const rv = fv.map!.get(row);
        if (rv !== undefined && rv.slots !== null) rv.enqueueSlots(this, p);
      }
    }
  }

  /** Reaches every getter occurrence that read `p` (or a pattern under it) at `row`. */
  walkDependents(p: Pattern, row: StateRow | null, visit: Visit): void {
    this.forSubtree(p, (q) => {
      const deps = q.dependents;
      for (let i = 0; i < deps.length; i++) {
        const g = deps[i];
        if (g.depth === 0) this.visitGetter(g, null, visit);
        else if (row === null || q.depth === 0 || g.lists[1] !== q.lists[1] || (g.crossSources !== null && g.crossSources.has(q))) {
          this.forAllRows(g.lists[g.depth]!, (r) => this.visitGetter(g, r, visit));
        } else if (g.depth <= q.depth) {
          const r = rowAt(row, g.depth);
          if (r !== null) this.visitGetter(g, r, visit);
        } else this.forRowsUnder(row, g, (r) => this.visitGetter(g, r, visit));
      }
    });
  }

  visitGetter(g: Pattern, row: StateRow | null, visit: Visit): void {
    if (!visit(g, row)) return;
    hooks.getterReached?.(this, g, row);
    this.enqueueBound(g, row);
    this.walkDependents(g, row, visit);
  }

  forSubtree(p: Pattern, fn: (q: Pattern) => void): void {
    fn(p);
    const c = p.children;
    for (let i = 0; i < c.length; i++) this.forSubtree(c[i], fn);
  }

  /** Every row of every list instance of list pattern `listP`. */
  forAllRows(listP: Pattern, fn: (row: StateRow) => void): void {
    this.forAllLists(listP, (l) => {
      for (const r of l.rows) fn(r);
    });
  }

  /** Every list instance of list pattern `listP`. */
  private forAllLists(listP: Pattern, fn: (l: StateList) => void): void {
    if (listP.depth === 0) {
      const l = this.rootLists.get(listP);
      if (l !== undefined) fn(l);
      return;
    }
    this.forAllRows(listP.lists[listP.depth]!, (parent) => {
      const l = parent.children?.get(listP);
      if (l !== undefined) fn(l);
    });
  }

  /** Rows at g.depth at or under `row` (row.depth <= g.depth). */
  forRowsUnder(row: StateRow, g: Pattern, fn: (row: StateRow) => void): void {
    if (row.list.depth === g.depth) return fn(row);
    const l = row.children?.get(g.lists[row.list.depth + 1]!);
    if (l !== undefined) for (const r of l.rows) this.forRowsUnder(r, g, fn);
  }

  // ---------------------------------------------------------------- bindings & drain

  /** Registers a binding where a change of its location finds it: its row, or the root table. */
  register(b: Binding): void {
    const row = b.row;
    if (row !== null) {
      (row.bindings ?? (row.bindings = [])).push(b);
      return;
    }
    upsert(this.rootBindings, b.pattern, newSet<Binding>).add(b);
  }

  unregister(b: Binding): void {
    const row = b.row;
    if (row === null) {
      this.rootBindings.get(b.pattern)?.delete(b);
      return;
    }
    // a row that left its list takes its registrations with it
    const bs = row.bindings;
    if (row.alive && bs !== null) bs.splice(bs.indexOf(b) >>> 0, 1);
  }

  enqueue(b: Binding): void {
    if (b.queued) return;
    b.queued = true;
    this.queue.push(b);
    this.schedule();
  }

  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(this.drainFn);
  }

  /** Drops the queued work of a cut update loop: what it would have shown waits for the next change. */
  private dropWork(): void {
    for (const b of this.queue) b.queued = false;
    for (const l of this.dirtyLists) l.queued = false;
    for (const l of this.staleLists) l.stale = false;
    this.queue = [];
    this.dirtyLists = [];
    this.staleLists = [];
    this.strategy.dropped(this);
  }

  /**
   * Cuts an update loop past `max` (`id`: its message): reported with the paths its queued work
   * would have rendered (the console, and DevTools as `state:render-chain-limit`), then dropped.
   */
  private cutLoop(id: M, max: number): void {
    const paths = [...new Set([...this.queue, ...this.dirtyLists, ...this.staleLists].map((x) => x.pattern.path))];
    console.error(`[@wcstack/state] ${text(id)}`, paths);
    hooks.noticed?.(this, { "type": "state:render-chain-limit", "maxDepth": max, "paths": paths });
    this.dropWork();
  }

  drain(): void {
    this.scheduled = false;
    // a drain only rendering fed (no write from code since the last) continues a chain: the carried
    // one of a deferred apply, or the task's
    const carried = this.carried;
    this.carried = 0;
    let chain = 0;
    if (!this.fedBack || this.codeWrote) this.unchainFn();
    else if (carried > 0) chain = carried;
    else if ((chain = ++this.chain) === 1) setTimeout(this.unchainFn, 0);
    this.fedBack = this.codeWrote = false;
    if (chain > MAX_RENDER_CHAIN) {
      if (chain === MAX_RENDER_CHAIN + 1) this.cutLoop(M.RenderChain, MAX_RENDER_CHAIN);
      else this.dropWork();
      return;
    }
    this.draining = true;
    try {
      for (let pass = 0; this.queue.length > 0 || this.dirtyLists.length > 0 || this.staleLists.length > 0; pass++) {
        if (pass >= MAX_DRAIN_PASSES) {
          // (once a chain: a reaction that starts the same loop again in each drain is not reported again)
          if (this.unsettled) this.dropWork();
          else this.cutLoop(M.DrainNotSettled, MAX_DRAIN_PASSES);
          this.unsettled = true;
          break;
        }
        const stale = this.staleLists;
        if (stale.length > 0) {
          this.staleLists = [];
          for (const l of stale) {
            l.stale = false;
            this.trySync(l);
          }
        }
        const lists = this.dirtyLists;
        const q = this.queue;
        this.dirtyLists = [];
        this.queue = [];
        // the DOM changes of this pass go to the page's view-transition arbiter, if any
        // (transition-runner protocol): with none, they are applied right here. Queued
        // entries stay marked until applied, so a write meanwhile folds into them
        const pending = runTransition("state", () => {
          // list views first (they build rows), then bindings
          for (const l of lists) {
            l.queued = false;
            for (const v of [l.view, ...(l.extra ?? [])]) {
              if (v === null || !v.alive) continue;
              // a row that fails to build (a binding refused as it is attached) fails this view
              // alone: the rest of the pass is still applied (nothing stays queued)
              try {
                v.update();
              } catch (error) {
                this.failAt(error, l.pattern.path, v.anchor, "for");
              }
            }
          }
          for (let i = 0; i < q.length; i++) {
            const b = q[i];
            // applied since it was queued (a row slot, when its row was built)
            if (!b.queued) continue;
            b.queued = false;
            if (b.owner === null || b.owner.alive) this.applyBinding(b);
          }
          // applied later by the arbiter, outside any drain: report its failures now, and the drain
          // what it fed back starts (a write-back, `$renderedCallback`) is the next of this drain's chain
          if (!this.draining) {
            this.report();
            if (this.scheduled) this.carried = chain + 1;
          }
        });
        if (pending !== undefined) pending.then(undefined, (e) => console.error(e));
      }
    } finally {
      this.draining = false;
    }
    // (writes made while applying are this drain's own passes)
    this.fedBack = this.codeWrote = false;
    this.report();
    hooks.drained?.(this);
    // (as is the one a carried drain's reactions start)
    if (carried > 0 && this.scheduled) this.carried = chain + 1;
  }

  // ---------------------------------------------------------------- apply, hooks, reports

  /** A binding that failed to apply: reported after the drain. */
  fail(error: unknown, b: Binding): void {
    this.errors.push([error, b]);
  }

  /**
   * A failure of what has no Binding object, reported like a binding's: a list that failed to sync
   * or render (its `for`), a binding refused as it was attached in a row.
   */
  failAt(error: unknown, path: string, node: Node | null, type: string): void {
    this.fail(error, { pattern: { path }, node, typeName: () => type } as unknown as Binding);
  }

  applyBinding(b: Binding): void {
    try {
      b.apply();
    } catch (error) {
      this.errors.push([error, b]);
      return;
    }
    if (this.rendered !== null) this.noteRendered(b.pattern, b.row);
  }

  /** Records an applied binding for `$renderedCallback`. */
  noteRendered(p: Pattern, row: StateRow | null): void {
    const list = upsert(this.rendered!, p.path, newArray<number[]>);
    if (row !== null) list.push(this.indexesOf(row));
  }

  /** Starts collecting applied paths when the state declares `$renderedCallback`. */
  watchRendered(): void {
    this.rendered = typeof this.target.$renderedCallback === "function" ? new Map() : null;
  }

  /** `$renderedCallback` for the paths applied since the last report, then binding failures. */
  report(): void {
    const rendered = this.rendered;
    if (rendered !== null && rendered.size > 0) {
      this.rendered = new Map();
      const paths = [...rendered.keys()];
      const indexes: Record<string, number[][]> = {};
      for (const [p, l] of rendered) if (l.length > 0) indexes[p] = l;
      this.feeding++;
      let r: any;
      try {
        r = this.callHook("$renderedCallback", [paths, indexes]);
      } catch (e) {
        console.error(e);
      }
      if (isThenable(r)) {
        r.then(this.renderedFn, (e: unknown) => {
          this.renderedFn();
          console.error(e);
        });
      } else {
        this.feeding--;
      }
    }
    if (this.errors.length === 0) return;
    const errors = this.errors;
    this.errors = [];
    const hook = this.target.$errorCallback;
    for (const [error, binding] of errors) {
      hooks.failed?.(this, error, binding);
      const path = binding.pattern.path;
      const type = binding.typeName();
      if (typeof hook === "function") {
        // quoted keys: the author reads them (mangle.mjs shortens the unquoted ones)
        try {
          const r = this.callHook("$errorCallback", [error, { "path": path, "bindingType": type, "node": binding.node }]) as any;
          if (isThenable(r)) r.then(undefined, (e: unknown) => console.error(e));
        } catch (e) {
          console.error(e);
        }
      } else {
        console.error(`[@wcstack/state] ${text(M.BindingFailed, [type, path])}`, error);
      }
    }
  }

  /** Runs a lifecycle hook with the writable proxy; returns its result (awaited by the caller or not). */
  callHook(name: string, args: unknown[] = []): unknown {
    const fn = this.target[name];
    return typeof fn === "function" ? this.callAt(fn, null, args) : undefined;
  }

  // ---------------------------------------------------------------- $getAll / $setAll / $resolve

  /** Calls fn for every row at p.depth that matches `indexes` (a prefix over p's wildcards). */
  private forMatches(p: Pattern, indexes: readonly number[], fn: (row: StateRow | null, idx: number[]) => void): void {
    if (p.depth === 0) {
      fn(null, []);
      return;
    }
    const idx: number[] = [];
    const walk = (k: number, parent: StateRow | null): void => {
      const lp = p.lists[k]!;
      // the list itself is read too: a getter over $getAll sees the first row of an empty list
      this.read(lp, parent);
      const list = this.childList(parent, lp);
      const visit = (r: StateRow): void => {
        idx.push(r.index);
        if (k === p.depth) fn(r, idx);
        else walk(k + 1, r);
        idx.pop();
      };
      for (const r of k - 1 < indexes.length ? [list.rows[indexes[k - 1]]] : list.rows) if (r !== undefined) visit(r);
    };
    walk(1, null);
  }

  private getAll(path: string, indexes?: number[]): unknown[] {
    const p = this.pattern(path);
    if (indexes !== undefined) this.checkArity("$getAll", path, p, indexes, false);
    // by default the loop context, on the wildcard levels the path shares with it
    let idx = indexes;
    if (idx === undefined) {
      idx = [];
      const ctx = this.ctx;
      if (ctx !== null && p.depth > 0) {
        for (let k = 1; k <= p.depth; k++) {
          const r = ctxRow(ctx, p, k);
          if (r === null) break;
          idx.push(r.index);
        }
        if (idx.length === 0) raise(M.GetAllNoCommonLevel, [path]);
      }
    }
    const out: unknown[] = [];
    this.forMatches(p, idx, (row) => out.push(this.read(p, row)));
    return out;
  }

  private setAll(path: string, indexes: number[], value: unknown, options?: { spread?: boolean }): number {
    if (!Array.isArray(indexes)) raise(M.SetAllNeedsIndexes, [path]);
    if (this.readonlyDepth > 0) raise(M.Readonly);
    const p = this.pattern(path);
    this.checkArity("$setAll", path, p, indexes, false);
    const targets: [StateRow | null, number[]][] = [];
    this.forMatches(p, indexes, (row, idx) => targets.push([row, idx.slice()]));
    const spread = options?.spread === true;
    if (spread && (!Array.isArray(value) || value.length !== targets.length)) {
      raise(M.SetAllSpreadLength, [path, targets.length]);
    }
    let written = 0;
    for (let i = 0; i < targets.length; i++) {
      const [row, idx] = targets[i];
      const v = typeof value === "function"
        ? (value as (cur: unknown, ...i: number[]) => unknown)(this.readUntracked(p, row), ...idx)
        : spread ? (value as unknown[])[i] : value;
      if (v === undefined) continue;
      this.write(p, row, v);
      written++;
    }
    return written;
  }

  /** `$resolve` takes exactly one index per `*`; `$getAll` / `$setAll` at most one (fewer expands the rest). */
  private checkArity(api: string, path: string, p: Pattern, indexes: readonly number[], exact: boolean): void {
    const n = indexes.length;
    if (n > p.depth || (exact && n < p.depth)) {
      raise(exact ? M.IndexArityExact : M.IndexArityAtMost, [api, path, p.depth, n]);
    }
  }
}
