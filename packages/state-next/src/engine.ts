import { Pattern, PatternTable, parsePath, WILDCARD, type EqSub } from "./pattern";
import { StateList, StateRow, reconcile, type ReconcileHooks } from "./list";
import type { Strategy } from "./strategy/types";
import type { Binding } from "./dom/view";
import { commandNamespace, eventTokens, type Token } from "./token";
import { runTransition } from "./protocol/transitionRunner";
import { raiseError } from "./parser/raiseError";
import { hooks, requireFeature } from "./hooks";

/** Declarations an add-on serves: without it installed they fail instead of doing nothing. */
const DECLARATIONS: [string, string][] = [["$watch", "temporal"], ["$stream", "temporal"], ["$listKeys", "list-keys"], ["$recursion", "recursion"]];

function checkDeclarations(target: Record<string, any>): void {
  for (const [key, feature] of DECLARATIONS) if (target[key] !== undefined) requireFeature(feature, key);
  if (target.$scan !== undefined) raiseError("$scan was removed (use $watch or $on)");
}

/** `$1` … `$128`, no leading zero. */
const INDEX_PARAM = /^\$[1-9]\d{0,2}$/;
const MAX_INDEX_PARAM = 128;

interface Frame {
  getter: Pattern;
  row: StateRow | null;
  untracked: number;
}

/** A drain that keeps producing work this many times in a row is an update loop. */
const MAX_DRAIN_PASSES = 32;
/** Nested getter evaluations deeper than this are a runaway chain. */
const MAX_GETTER_DEPTH = 128;

export type Visit = (getter: Pattern, row: StateRow | null) => boolean;

/** Map-key equality: Object.is, except +0 and -0 are equal (keys of a Map). */
function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || (a !== a && b !== b);
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

/**
 * One engine per <wcs-state>. It owns everything reachable from its state: the
 * patterns, the lists and their rows, the bindings, the update queue. Nothing is keyed
 * by the state element, because nothing is shared between engines.
 */
export class Engine implements ReconcileHooks {
  target: Record<string, any>;
  readonly patterns: PatternTable;
  readonly strategy: Strategy;
  readonly proxy: Record<string, any>;
  /** Number of row-level getter slots. */
  slotCount = 0;
  /** Drain pass counter (walk de-duplication). */
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
  /** `$command`: the command tokens declared in `$commandTokens`. */
  commands: Readonly<Record<string, Token>>;
  /** The event tokens declared in `$eventTokens`, with the `$on` handlers subscribed. */
  events: Map<string, Token>;
  /** Binding failures of the current drain, reported after it (`$errorCallback` or console). */
  private errors: { error: unknown; binding: Binding }[] = [];
  /** Paths applied in the current drain, for `$renderedCallback` (collected only when declared). */
  rendered: Map<string, number[][]> | null = null;
  private frames: Frame[] = [];
  private depthNow = 0;
  private top: Frame | null = null;
  readonly rootLists = new Map<Pattern, StateList>();
  readonly rootBindings = new Map<Pattern, Set<Binding>>();
  private queue: Binding[] = [];
  private dirtyLists: StateList[] = [];
  private scheduled = false;
  private draining = false;
  // out-parameters of resolve()
  private rp: Pattern | null = null;
  private rr: StateRow | null = null;

  private readonly drainFn = () => this.drain();
  private readonly deliverFn = (handler: (...a: unknown[]) => unknown, args: unknown[]) => handler(this.proxy, ...args);
  private readonly untrackedFn = (fn: () => unknown) => this.untracked(fn);
  private readonly eqIndexFn = (path: string, level = 1) => this.eqIndex(path, level);
  private readonly eqFn = (path: string, key: unknown) => this.eq(path, key);
  private readonly eqPathFn = (path: string, keyPath: string) => {
    const kp = this.pattern(keyPath);
    return this.eq(path, this.readUntracked(kp, kp.depth === 0 ? null : rowAt(this.ctx, kp.depth)));
  };
  /** `$eq` subscriptions of root-level getters. */
  private readonly rootEqSubs: { source: Pattern; key: unknown; sub: EqSub }[] = [];
  private readonly dependOnFn = (path: string) => {
    this.resolve(path, this.ctx);
    if (this.top !== null && this.top.untracked === 0) this.track(this.rp!, this.rr, this.top);
  };
  private readonly getAllFn = (path: string, indexes?: number[]) => this.getAll(path, indexes);
  private readonly setAllFn = (path: string, indexes: number[], value: unknown, options?: { spread?: boolean }) =>
    this.setAll(path, indexes, value, options);
  private readonly resolveFn = (...args: unknown[]) => this.resolveApi(args);
  private readonly postUpdateFn = (path: string) => {
    this.resolve(path, this.ctx);
    if (hooks.written !== null) hooks.written(this, this.rp!, this.rr, undefined, undefined, false);
    this.changed(this.rp!, this.rr);
  };

  constructor(target: Record<string, any>, strategy: Strategy) {
    this.target = target;
    this.strategy = strategy;
    this.patterns = new PatternTable((p) => this.onPatternCreated(p));
    checkDeclarations(target);
    if (hooks.declare !== null) hooks.declare(this, target);
    this.registerAccessors(target);
    this.commands = commandNamespace(target);
    this.events = eventTokens(target, this.deliverFn);
    const engine = this;
    // the handler reads engine.target, not the proxy's target: a re-set swaps the state
    this.proxy = new Proxy(target, {
      get(_t, key) {
        const t = engine.target;
        if (typeof key === "symbol") return Reflect.get(t, key);
        if (key.charCodeAt(0) === 36 /* $ */) return engine.dollar(key);
        if (key.indexOf(".") < 0) {
          const p = engine.patterns.peek(key);
          if (p === undefined || p.getter === null) {
            const v = t[key];
            if (typeof v === "function") return v;
          }
          // a known top-level key: no path to parse
          if (p !== undefined && p.depth === 0) return engine.read(p, null);
        }
        engine.resolve(key, engine.ctx);
        return engine.read(engine.rp!, engine.rr);
      },
      set(_t, key, value) {
        if (typeof key === "symbol") return Reflect.set(engine.target, key, value);
        engine.resolve(key, engine.ctx);
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
    if (p.last === "**") raiseError(`[wcs/recursion-unsupported] "${p.path}" uses "**", which is not accepted here.`);
    const parent = p.parent;
    p.underGetter = parent !== null && p.last !== WILDCARD && parent.depth === p.depth &&
      (parent.getter !== null || parent.underGetter);
  }

  // ---------------------------------------------------------------- lists

  rootList(p: Pattern): StateList {
    let l = this.rootLists.get(p);
    if (l === undefined) {
      l = new StateList(p, null);
      this.rootLists.set(p, l);
    }
    this.sync(l);
    return l;
  }

  childList(row: StateRow, p: Pattern): StateList {
    const m = row.children ?? (row.children = new Map());
    let l = m.get(p);
    if (l === undefined) {
      l = new StateList(p, row);
      m.set(p, l);
    }
    this.sync(l);
    return l;
  }

  /** Reconciles a list's rows with the current value of its pattern. */
  sync(l: StateList): void {
    const value = this.readUntracked(l.pattern, l.parentRow);
    if (value === l.arr) return;
    const old = reconcile(l, value, this);
    if (old === null) return;
    if (hooks.listSynced !== null) hooks.listSynced(this, l, old);
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
        if (before !== undefined && before.alive) this.strategy.invalidate(this, getter, before);
        if (after !== undefined) this.strategy.invalidate(this, getter, after);
      }
    }
  }

  indexChanged(row: StateRow): void {
    this.strategy.onIndexChange(this, row);
  }

  rowRemoved(row: StateRow): void {
    const subs = row.eqSubs;
    if (subs !== null) {
      for (const e of subs) e.source.eqSubs?.get(e.key)?.delete(e.sub);
      row.eqSubs = null;
    }
    // the rows of its nested lists go with it
    if (row.children !== null) {
      for (const l of row.children.values()) {
        for (const r of l.rows) {
          r.alive = false;
          this.rowRemoved(r);
        }
      }
    }
  }

  // ---------------------------------------------------------------- resolve / read

  /** Splits a concrete path into (pattern, row) — written to this.rp / this.rr. */
  resolve(path: string, ctx: StateRow | null): void {
    const parsed = parsePath(path);
    const p = this.pattern(parsed.pattern);
    this.rp = p;
    if (p.depth === 0) {
      this.rr = null;
      return;
    }
    const idx = parsed.indexes;
    if (idx === null) {
      this.rr = rowAt(ctx, p.depth);
      return;
    }
    let row: StateRow | null = null;
    for (let k = 1; k <= p.depth; k++) {
      const listP = p.lists[k]!;
      const list: StateList = k === 1 ? this.rootList(listP) : this.childList(row!, listP);
      let i = idx[k - 1];
      if (i === -1) i = rowAt(ctx, k)?.index ?? -1;
      row = list.rows[i] ?? null;
      if (row === null) break;
    }
    this.rr = row;
  }

  /** Raw data read (no getter, no tracking). `row` is the row at p.depth. */
  readData(p: Pattern, row: StateRow | null): unknown {
    let v: any;
    if (p.depth === 0) v = this.target;
    else if (row === null) return undefined;
    else v = row.item;
    const tail = p.tail;
    for (let i = 0; i < tail.length; i++) {
      if (v == null) return undefined;
      v = v[tail[i]];
    }
    return v;
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
    if (p.parent === null && !(p.last in this.target)) {
      raiseError(`[wcs/binding-path-missing] Path "${p.path}" does not exist on the state tree.`, p.last, Object.keys(this.target));
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
      if (f.getter === g && f.row === row) raiseError(`[wcs/getter-cycle] "${g.path}" depends on itself`);
    }
    if (this.depthNow >= MAX_GETTER_DEPTH) raiseError(`[wcs/getter-depth-exceeded] "${g.path}"`);
    const depth = this.depthNow++;
    this.readonlyDepth++;
    let frame = this.frames[depth];
    if (frame === undefined) this.frames[depth] = frame = { getter: g, row, untracked: 0 };
    else {
      frame.getter = g;
      frame.row = row;
      frame.untracked = 0;
    }
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

  private untracked(fn: () => unknown): unknown {
    const f = this.top;
    if (f === null) return fn();
    f.untracked++;
    try {
      return fn();
    } finally {
      f.untracked--;
    }
  }

  private dollar(key: string): unknown {
    const c = key.charCodeAt(1);
    if (c >= 48 && c <= 57) {
      const n = key.length === 2 ? c - 48 : INDEX_PARAM.test(key) ? Number(key.slice(1)) : 0;
      if (n < 1 || n > MAX_INDEX_PARAM) {
        raiseError(`[wcs/index-param-range] "${key}": list index parameters run from $1 to $${MAX_INDEX_PARAM}.`);
      }
      {
        const f = this.top;
        if (f !== null && f.untracked === 0) {
          const g = f.getter;
          const listP = g.lists[n];
          if (!g.indexDependent) g.indexDependent = true;
          if (listP) {
            const w = listP.indexWatchers ?? (listP.indexWatchers = []);
            if (!w.includes(g)) w.push(g);
          }
        }
        return rowAt(this.ctx, n)?.index;
      }
    }
    switch (key) {
      case "$untracked":
      case "$untrackDependency":
        return this.untrackedFn;
      case "$eqIndex":
        return this.eqIndexFn;
      case "$eq":
        return this.eqFn;
      case "$eqPath":
        return this.eqPathFn;
      case "$dependOn":
      case "$trackDependency":
        return this.dependOnFn;
      case "$postUpdate":
        return this.postUpdateFn;
      case "$getAll":
        return this.getAllFn;
      case "$setAll":
        return this.setAllFn;
      case "$resolve":
        return this.resolveFn;
      case "$stateElement":
        return this.element;
      case "$command":
        return this.commands;
    }
    return hooks.dollar === null ? undefined : hooks.dollar(this, key);
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
    if (f !== null && f.untracked === 0) this.subscribeEq(source, key, f.getter, f.row);
    return sameValueZero(this.readUntracked(source, null), key);
  }

  private subscribeEq(source: Pattern, key: unknown, getter: Pattern, row: StateRow | null): void {
    const list = row === null ? this.rootEqSubs : (row.eqSubs ?? (row.eqSubs = []));
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.sub.getter !== getter || e.source !== source) continue;
      if (sameValueZero(e.key, key)) return;
      source.eqSubs?.get(e.key)?.delete(e.sub); // the key moved
      list.splice(i, 1);
      break;
    }
    const sub: EqSub = { getter, row };
    const map = source.eqSubs ?? (source.eqSubs = new Map());
    let set = map.get(key);
    if (set === undefined) map.set(key, (set = new Set()));
    set.add(sub);
    list.push({ source, key, sub });
  }

  /** Invalidates the occurrences keyed under `before` and `after` of `source`. */
  private rekeyEq(source: Pattern, before: unknown, after: unknown): void {
    const map = source.eqSubs;
    if (map === null) return;
    for (const k of [before, after]) {
      const set = map.get(k);
      if (set === undefined) continue;
      for (const sub of set) {
        if (sub.row !== null && !sub.row.alive) {
          set.delete(sub);
          continue;
        }
        this.strategy.invalidate(this, sub.getter, sub.row);
      }
    }
  }

  /** A root write to `p` (or an object above a `$eq` source): re-key every source at or under it. */
  private rekeyEqUnder(p: Pattern, before: unknown, after: unknown): void {
    this.forSubtree(p, (q) => {
      if (q.eqSubs === null) return;
      if (q === p) {
        this.rekeyEq(q, before, after);
        return;
      }
      const rest = q.path.slice(p.path.length + 1).split(".");
      this.rekeyEq(q, dig(before, rest), dig(after, rest));
    });
  }

  private eqIndex(path: string, level: number): boolean {
    const row = rowAt(this.ctx, level);
    if (row === null) throw new Error(`$eqIndex("${path}") needs a list row scope.`);
    const source = this.pattern(path);
    const f = this.top;
    if (f !== null) {
      const g = f.getter;
      const watchers = source.eqIndexWatchers ?? (source.eqIndexWatchers = []);
      if (!watchers.some((w) => w.getter === g)) {
        watchers.push({ getter: g, level });
        const listP = g.lists[level]!;
        (listP.eqIndexKeys ?? (listP.eqIndexKeys = [])).push({ source, getter: g });
      }
    }
    return row.index === this.readUntracked(source, null);
  }

  // ---------------------------------------------------------------- write

  /** `occurrence`: an event-semantics write, applied even when equal to the current value. */
  write(p: Pattern, row: StateRow | null, value: unknown, occurrence = false): void {
    if (this.readonlyDepth > 0) throw new Error("This state is readonly.");
    if (hooks.beforeWrite !== null && hooks.beforeWrite(this, p, row, value)) return;
    if (p.setter !== null) {
      const prev = this.ctx;
      this.ctx = row;
      try {
        p.setter.call(this.proxy, value);
      } finally {
        this.ctx = prev;
      }
      if (hooks.written !== null) hooks.written(this, p, row, undefined, undefined, false);
      this.changed(p, row);
      return;
    }
    if (p.getter !== null) raiseError(`"${p.path}" is a getter without a setter`);
    if (p.depth > 0 && row === null) raiseError(`no row for "${p.path}"`);
    const old = this.readData(p, row);
    if (!occurrence && Object.is(old, value) && (value === null || (typeof value !== "object" && typeof value !== "function"))) return;
    if (p.last === WILDCARD) {
      // element write: the position keeps its row, the row takes the new value
      const r = row!;
      (r.list.arr as unknown[])[r.index] = value;
      r.item = value;
      this.strategy.resetRow(r);
      if (r.children !== null) for (const l of r.children.values()) this.sync(l);
    } else {
      const parent = (p.tail.length === 1
        ? (p.depth === 0 ? this.target : row!.item)
        : this.readUntracked(p.parent!, row)) as any;
      if (parent == null) raiseError(`cannot write "${p.path}": its parent is ${parent}`);
      parent[p.last] = value;
      this.syncListsUnder(p, row);
    }
    if (p.eqIndexWatchers !== null) this.rekeyEqIndex(p, old, value);
    if (p.depth === 0) this.rekeyEqUnder(p, old, value);
    if (hooks.written !== null) hooks.written(this, p, row, old, value, true);
    this.changed(p, row);
  }

  private syncListsUnder(p: Pattern, row: StateRow | null): void {
    if (row === null) {
      for (const l of this.rootLists.values()) if (l.pattern.isUnder(p)) this.sync(l);
    } else if (row.children !== null) {
      for (const l of row.children.values()) if (l.pattern.isUnder(p)) this.sync(l);
    }
  }

  private rekeyEqIndex(source: Pattern, before: unknown, after: unknown): void {
    for (const { getter, level } of source.eqIndexWatchers!) {
      if (level !== 1) continue; // spike: root lists only
      const list = this.rootLists.get(getter.lists[1]!);
      if (list === undefined) continue;
      for (const k of [before, after]) {
        if (typeof k !== "number") continue;
        const r = list.rows[k];
        if (r !== undefined) this.strategy.invalidate(this, getter, r);
      }
    }
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
        // a root-level element's own handler
        const fn = n[key];
        if (fn !== undefined) {
          fn(e, null);
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
    checkDeclarations(target);
    if (hooks.declare !== null) hooks.declare(this, target);
    this.target = target;
    this.slotCount = 0;
    for (const p of this.patterns.all()) p.forget();
    this.rootEqSubs.length = 0;
    this.registerAccessors(target);
    this.commands = commandNamespace(target, this.commands);
    this.events = eventTokens(target, this.deliverFn);
    for (const bs of this.rootBindings.values()) for (const b of bs) this.enqueue(b);
    for (const l of this.rootLists.values()) this.resetList(l);
    const rendered = this.rendered;
    this.rendered = null;
    try {
      this.drain();
    } finally {
      this.rendered = rendered;
      this.watchRendered();
    }
    if (hooks.element !== null) hooks.element(this, "reset");
  }

  private resetList(l: StateList): void {
    this.sync(l);
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
    if (token === undefined) raiseError(`[wcs/token-undeclared] eventToken "${name}" is not declared in $eventTokens.`, name, this.events.keys());
    token.emit(event, ...this.indexesOf(row));
  }

  /** `onclick: $command.<name>` — emits the token with (event, ...listIndexes). */
  emitCommand(name: string, event: Event, row: StateRow | null): void {
    const token = this.commands[name];
    if (token === undefined) raiseError(`[wcs/token-undeclared] "$command.${name}" is not declared in $commandTokens.`, name, Object.keys(this.commands));
    token.emit(event, ...this.indexesOf(row));
  }

  // ---------------------------------------------------------------- methods

  invoke(name: string, event: Event, row: StateRow | null): unknown {
    const fn = this.target[name];
    if (typeof fn !== "function") raiseError(`"${name}" is not a method`);
    const args: unknown[] = [event];
    const indexes: number[] = [];
    for (let r = row; r !== null; r = r.list.parentRow) indexes.push(r.index);
    for (let i = indexes.length - 1; i >= 0; i--) args.push(indexes[i]);
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

  walkChange(p: Pattern, row: StateRow | null, visit: Visit): void {
    this.enqueueBound(p, row);
    this.walkDependents(p, row, visit);
  }

  /** Reaches every getter occurrence that read `p` (or a pattern under it) at `row`. */
  walkDependents(p: Pattern, row: StateRow | null, visit: Visit): void {
    this.forSubtree(p, (q) => {
      const deps = q.dependents;
      for (let i = 0; i < deps.length; i++) this.reach(q, row, deps[i], visit);
    });
  }

  visitGetter(g: Pattern, row: StateRow | null, visit: Visit): void {
    if (!visit(g, row)) return;
    if (hooks.getterReached !== null) hooks.getterReached(this, g, row);
    this.enqueueBound(g, row);
    this.walkDependents(g, row, visit);
  }

  private reach(q: Pattern, row: StateRow | null, g: Pattern, visit: Visit): void {
    if (g.depth === 0) {
      this.visitGetter(g, null, visit);
      return;
    }
    const cross = row === null || q.depth === 0 || g.lists[1] !== q.lists[1] ||
      (g.crossSources !== null && g.crossSources.has(q));
    if (cross) {
      this.forAllRows(g.lists[g.depth]!, (r) => this.visitGetter(g, r, visit));
      return;
    }
    if (g.depth <= q.depth) {
      const r = rowAt(row, g.depth);
      if (r !== null) this.visitGetter(g, r, visit);
      return;
    }
    this.forRowsUnder(row!, g, (r) => this.visitGetter(g, r, visit));
  }

  forSubtree(p: Pattern, fn: (q: Pattern) => void): void {
    fn(p);
    const c = p.children;
    for (let i = 0; i < c.length; i++) this.forSubtree(c[i], fn);
  }

  /** Every row of every list instance of list pattern `listP`. */
  forAllRows(listP: Pattern, fn: (row: StateRow) => void): void {
    if (listP.depth === 0) {
      const l = this.rootLists.get(listP);
      if (l !== undefined) {
        const rs = l.rows;
        for (let i = 0; i < rs.length; i++) fn(rs[i]);
      }
      return;
    }
    this.forAllRows(listP.lists[listP.depth]!, (parent) => {
      const l = parent.children?.get(listP);
      if (l !== undefined) for (const r of l.rows) fn(r);
    });
  }

  /** Rows at g.depth under `row` (row.depth < g.depth). */
  forRowsUnder(row: StateRow, g: Pattern, fn: (row: StateRow) => void): void {
    const next = g.lists[row.list.depth + 1];
    if (!next) return;
    const l = row.children?.get(next);
    if (l === undefined) return;
    for (const r of l.rows) {
      if (r.list.depth === g.depth) fn(r);
      else this.forRowsUnder(r, g, fn);
    }
  }

  // ---------------------------------------------------------------- bindings & drain

  /** Registers a binding where a change of its location finds it: its row, or the root table. */
  register(b: Binding): void {
    const row = b.row;
    if (row !== null) {
      (row.bindings ?? (row.bindings = [])).push(b);
      return;
    }
    let bs = this.rootBindings.get(b.pattern);
    if (bs === undefined) this.rootBindings.set(b.pattern, (bs = new Set()));
    bs.add(b);
  }

  unregister(b: Binding): void {
    const row = b.row;
    if (row === null) {
      this.rootBindings.get(b.pattern)?.delete(b);
      return;
    }
    // a row that left its list takes its registrations with it
    if (!row.alive) return;
    const bs = row.bindings;
    if (bs === null) return;
    const i = bs.indexOf(b);
    if (i >= 0) bs.splice(i, 1);
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

  drain(): void {
    this.scheduled = false;
    this.draining = true;
    try {
      for (let pass = 0; this.queue.length > 0 || this.dirtyLists.length > 0; pass++) {
        if (pass >= MAX_DRAIN_PASSES) {
          console.error(`[@wcstack/state] updates did not settle after ${MAX_DRAIN_PASSES} passes; the rest is dropped`);
          for (const b of this.queue) b.queued = false;
          for (const l of this.dirtyLists) l.queued = false;
          this.queue = [];
          this.dirtyLists = [];
          break;
        }
        const lists = this.dirtyLists;
        const q = this.queue;
        this.dirtyLists = [];
        this.queue = [];
        // the DOM changes of this pass go to the page's view-transition arbiter, if any
        // (transition-runner protocol): with none, they are applied right here. Queued
        // entries stay marked until applied, so a write meanwhile folds into them
        const pending = runTransition("state", () => this.applyPass(lists, q));
        if (pending !== undefined) pending.then(undefined, (e) => console.error(e));
      }
    } finally {
      this.draining = false;
    }
    this.report();
    if (hooks.drained !== null) hooks.drained(this);
  }

  /** The DOM work of one drain pass: list views first (they build rows), then bindings. */
  private applyPass(lists: StateList[], q: Binding[]): void {
    for (const l of lists) {
      l.queued = false;
      if (l.view !== null && l.view.alive) l.view.update();
      if (l.extra !== null) for (const v of l.extra.slice()) if (v.alive) v.update();
    }
    for (let i = 0; i < q.length; i++) {
      const b = q[i];
      b.queued = false;
      if (b.owner === null || b.owner.alive) this.applyBinding(b);
    }
    // applied later by the arbiter, outside any drain: report its failures now
    if (!this.draining) this.report();
  }

  // ---------------------------------------------------------------- apply, hooks, reports

  /** Applies one binding; a failure is confined to it and reported after the drain. */
  /** A binding that failed to apply: reported after the drain. */
  fail(error: unknown, b: Binding): void {
    this.errors.push({ error, binding: b });
  }

  applyBinding(b: Binding): void {
    try {
      b.apply();
    } catch (error) {
      this.errors.push({ error, binding: b });
      return;
    }
    if (this.rendered !== null) this.noteRendered(b.pattern, b.row);
  }

  /** Records an applied binding for `$renderedCallback`. */
  noteRendered(p: Pattern, row: StateRow | null): void {
    const rendered = this.rendered!;
    let list = rendered.get(p.path);
    if (list === undefined) rendered.set(p.path, (list = []));
    if (row !== null) {
      const idx: number[] = [];
      for (let r: StateRow | null = row; r !== null; r = r.list.parentRow) idx.unshift(r.index);
      list.push(idx);
    }
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
      this.callHookDetached("$renderedCallback", [paths, indexes]);
    }
    if (this.errors.length === 0) return;
    const errors = this.errors;
    this.errors = [];
    const hook = this.target.$errorCallback;
    for (const { error, binding } of errors) {
      const path = binding.pattern.path;
      const type = binding.typeName();
      if (typeof hook === "function") {
        // quoted keys: the author reads them (mangle.mjs shortens the unquoted ones)
        this.callHookDetached("$errorCallback", [error, { "path": path, "bindingType": type, "node": binding.node }]);
      } else {
        console.error(`[@wcstack/state] binding "${type}: ${path}" failed to apply; the rest of this batch continues.`, error);
      }
    }
  }

  /** Runs a lifecycle hook with the writable proxy; returns its result (awaited by the caller or not). */
  callHook(name: string, args: unknown[] = []): unknown {
    const fn = this.target[name];
    if (typeof fn !== "function") return undefined;
    const prev = this.ctx;
    this.ctx = null;
    try {
      return fn.apply(this.proxy, args);
    } finally {
      this.ctx = prev;
    }
  }

  /** A hook whose failure is reported but never breaks the caller (renderedCallback, errorCallback). */
  private callHookDetached(name: string, args: unknown[]): void {
    try {
      const r = this.callHook(name, args) as any;
      if (r !== null && typeof r === "object" && typeof r.then === "function") r.then(undefined, (e: unknown) => console.error(e));
    } catch (e) {
      console.error(e);
    }
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
      const list = k === 1 ? this.rootList(p.lists[1]!) : this.childList(parent!, p.lists[k]!);
      const visit = (r: StateRow): void => {
        idx.push(r.index);
        if (k === p.depth) fn(r, idx);
        else walk(k + 1, r);
        idx.pop();
      };
      if (k - 1 < indexes.length) {
        const r = list.rows[indexes[k - 1]];
        if (r !== undefined) visit(r);
      } else {
        const rows = list.rows;
        for (let i = 0; i < rows.length; i++) visit(rows[i]);
      }
    };
    walk(1, null);
  }

  /** $getAll's default indexes: the loop context, on the wildcard levels the path shares with it. */
  private contextIndexes(p: Pattern, path: string): number[] {
    const ctx = this.ctx;
    if (ctx === null || p.depth === 0) return [];
    const out: number[] = [];
    for (let k = 1; k <= p.depth; k++) {
      const r = rowAt(ctx, k);
      if (r === null || r.list.pattern !== p.lists[k]) break;
      out.push(r.index);
    }
    if (out.length === 0) {
      raiseError(`$getAll("${path}"): no loop level in common with the context; pass indexes ([] for all)`);
    }
    return out;
  }

  private getAll(path: string, indexes?: number[]): unknown[] {
    const p = this.pattern(path);
    if (indexes !== undefined) this.checkArity("$getAll", path, p, indexes, false);
    const idx = indexes ?? this.contextIndexes(p, path);
    const out: unknown[] = [];
    this.forMatches(p, idx, (row) => out.push(this.read(p, row)));
    return out;
  }

  private setAll(path: string, indexes: number[], value: unknown, options?: { spread?: boolean }): number {
    if (!Array.isArray(indexes)) throw new Error(`$setAll("${path}") needs indexes ([] for every match)`);
    if (this.readonlyDepth > 0) throw new Error("This state is readonly.");
    const p = this.pattern(path);
    this.checkArity("$setAll", path, p, indexes, false);
    const targets: { row: StateRow | null; idx: number[] }[] = [];
    this.forMatches(p, indexes, (row, idx) => targets.push({ row, idx: idx.slice() }));
    const spread = options?.spread === true;
    if (spread && (!Array.isArray(value) || value.length !== targets.length)) {
      throw new Error(`$setAll("${path}", …, { spread: true }) needs an array of ${targets.length} values`);
    }
    let written = 0;
    for (let i = 0; i < targets.length; i++) {
      const { row, idx } = targets[i];
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
      raiseError(`[wcs/index-arity] ${api}("${path}") takes ${exact ? "" : "at most "}${p.depth} index(es), got ${n}.`);
    }
  }

  /** $resolve(path, indexes) reads; $resolve(path, indexes, value) writes (the argument count decides). */
  private resolveApi(args: unknown[]): unknown {
    const path = args[0] as string;
    const indexes = (args[1] ?? []) as number[];
    const p = this.pattern(path);
    this.checkArity("$resolve", path, p, indexes, true);
    let row: StateRow | null = null;
    for (let k = 1; k <= p.depth; k++) {
      const list: StateList = k === 1 ? this.rootList(p.lists[1]!) : this.childList(row!, p.lists[k]!);
      const i = k - 1 < indexes.length ? indexes[k - 1] : rowAt(this.ctx, k)?.index ?? -1;
      row = list.rows[i] ?? null;
      if (row === null) break;
    }
    if (args.length >= 3) {
      this.write(p, row, args[2]);
      return undefined;
    }
    return this.read(p, row);
  }
}
