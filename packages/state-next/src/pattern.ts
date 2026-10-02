/**
 * Path patterns.
 *
 * A pattern is the authoring-level path with every list position written as `*`
 * (`data.*.label`). Each engine interns its patterns once; everything at run time
 * refers to the Pattern object, never to a path string. A concrete location is a
 * pattern plus the row that owns its last wildcard — there is no address object.
 */

export const WILDCARD = "*";

export class Pattern {
  readonly path: string;
  readonly parent: Pattern | null;
  readonly last: string;
  /** Number of `*` segments. 0 = a location on the root, n = a location inside a depth-n row. */
  readonly depth: number;
  /** Segments after the last `*` (all segments when depth is 0). Read from the row item / the root. */
  readonly tail: readonly string[];
  /** `lists[k]` is the list pattern whose rows the k-th wildcard (1-based) ranges over. */
  readonly lists: readonly (Pattern | null)[];
  readonly children: Pattern[] = [];

  // --- filled in by the engine ---
  getter: (() => unknown) | null = null;
  setter: ((value: unknown) => void) | null = null;
  /** true when some proper ancestor is an accessor (read through it instead of walking data). */
  underGetter = false;
  /** Getter patterns whose evaluation read this pattern. */
  readonly dependents: Pattern[] = [];
  /** Patterns this getter read (union over its evaluations). */
  readonly sources: Pattern[] = [];
  /** Sources read from a row other than the evaluating row's own chain (fan out on change). */
  crossSources: Set<Pattern> | null = null;
  /** Cache slot of a row-level getter on its rows. -1 when not a row-level getter. */
  slot = -1;
  /** Root-level getter cache (depth 0). */
  rootValue: unknown = UNSET;
  /** `$eqIndex(this path)` watchers: getters keyed on the index of their row at `level`. */
  eqIndexWatchers: { getter: Pattern; level: number }[] | null = null;
  /** On a list pattern: the `$eqIndex` registrations over its rows (re-keyed on reorder). */
  eqIndexKeys: { source: Pattern; getter: Pattern }[] | null = null;
  /** On a list pattern: getters that read the index (`$k`) of this list's rows. */
  indexWatchers: Pattern[] | null = null;
  /** `$eq(this path, key)` subscriptions: getter occurrences keyed by the value they wait for. */
  eqSubs: Map<unknown, Set<EqSub>> | null = null;

  private readonly dependentSet = new Set<Pattern>();

  constructor(path: string, last: string, parent: Pattern | null) {
    this.path = path;
    this.parent = parent;
    this.last = last;
    // the parent's list table, plus our own when we are a wildcard segment
    const lists: (Pattern | null)[] = parent === null ? [null] : parent.lists.slice();
    const w = last === WILDCARD;
    if (w) lists.push(parent);
    this.depth = lists.length - 1;
    this.tail = w ? [] : parent === null ? [last] : [...parent.tail, last];
    this.lists = lists;
  }

  addDependent(getter: Pattern): void {
    if (this.dependentSet.has(getter)) return;
    this.dependentSet.add(getter);
    this.dependents.push(getter);
    getter.sources.push(this);
  }

  /** A re-set replaced the state: forget its accessors and everything learned from them. */
  forget(): void {
    this.getter = null;
    this.setter = null;
    this.slot = -1;
    this.rootValue = UNSET;
    this.dependents.length = 0;
    this.dependentSet.clear();
    this.sources.length = 0;
    this.crossSources = null;
    this.eqIndexWatchers = null;
    this.eqIndexKeys = null;
    this.indexWatchers = null;
    this.eqSubs = null;
  }

  /** true when `this` is `ancestor` or lies under it. */
  isUnder(ancestor: Pattern): boolean {
    let p: Pattern | null = this;
    while (p !== null) {
      if (p === ancestor) return true;
      p = p.parent;
    }
    return false;
  }
}

/** One getter occurrence subscribed under a key of a `$eq` source. */
export interface EqSub {
  getter: Pattern;
  row: import("./list").StateRow | null;
}

/** Sentinel for "no cached value". */
export const UNSET: unique symbol = Symbol("unset") as never;
/** Sentinel for "cached value is stale" (dirty strategy). */
export const DIRTY: unique symbol = Symbol("dirty") as never;
/**
 * Sentinel for "evaluated, but it threw" (or stale with its readers dropped by a cut drain):
 * someone read it, so a change of its sources must reach it.
 */
export const FAILED: unique symbol = Symbol("failed") as never;

export class PatternTable {
  private readonly byPath = new Map<string, Pattern>();
  private readonly onCreate: ((p: Pattern) => void) | null;

  constructor(onCreate: ((p: Pattern) => void) | null = null) {
    this.onCreate = onCreate;
  }

  peek(path: string): Pattern | undefined {
    return this.byPath.get(path);
  }

  get(path: string): Pattern {
    let p = this.byPath.get(path);
    if (p !== undefined) return p;
    const i = path.lastIndexOf(".");
    const parent = i < 0 ? null : this.get(path.slice(0, i));
    p = new Pattern(path, path.slice(i + 1), parent);
    this.onCreate?.(p);
    this.byPath.set(path, p);
    if (parent) parent.children.push(p);
    return p;
  }

  all(): IterableIterator<Pattern> {
    return this.byPath.values();
  }
}

/**
 * A concrete path (`data.3.label`, `data.*.label`, `selectedIndex`) split into its
 * pattern and the explicit indexes it carries. `*` segments take their index from the
 * evaluation context, so they are returned as `-1`.
 */
export interface ParsedPath {
  pattern: string;
  indexes: number[] | null;
}

const literalCache = new Map<string, ParsedPath>();

export function parsePath(path: string): ParsedPath {
  const cached = literalCache.get(path);
  if (cached !== undefined) return cached;
  let literal = true;
  const segs = path.split(".");
  const indexes: number[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const c = s.charCodeAt(0);
    if (c >= 48 && c <= 57) {
      literal = false;
      indexes.push(Number(s));
      segs[i] = WILDCARD;
    } else if (s === WILDCARD) indexes.push(-1);
  }
  if (!literal) return { pattern: segs.join("."), indexes };
  const parsed: ParsedPath = { pattern: path, indexes: null };
  // literal paths (no explicit index) are few and reused: keep them
  literalCache.set(path, parsed);
  return parsed;
}
