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
  readonly id: number;
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
  /** The getter read `$1…$n`: a change of the row's position invalidates it. */
  indexDependent = false;
  /** Cache slot of a row-level getter on its rows. -1 when not a row-level getter. */
  slot = -1;
  /** Root-level getter cache (depth 0). */
  rootValue: unknown = UNSET;
  /** Version strategy: write clock of the last write to this pattern. */
  ver = 0;
  /** Version strategy: when rootValue was computed. */
  rootAt = -1;
  /** `$eqIndex(this path)` watchers: getters keyed on the index of their row at `level`. */
  eqIndexWatchers: { getter: Pattern; level: number }[] | null = null;
  /** On a list pattern: the `$eqIndex` registrations over its rows (re-keyed on reorder). */
  eqIndexKeys: { source: Pattern; getter: Pattern }[] | null = null;
  /** On a list pattern: getters that read the index (`$k`) of this list's rows. */
  indexWatchers: Pattern[] | null = null;
  /** Version strategy: drain epoch of the last walk visit (root-level getters). */
  seenEpoch = -1;
  /** `$eq(this path, key)` subscriptions: getter occurrences keyed by the value they wait for. */
  eqSubs: Map<unknown, Set<EqSub>> | null = null;

  private readonly dependentSet = new Set<Pattern>();

  constructor(id: number, path: string, segs: readonly string[], parent: Pattern | null) {
    this.id = id;
    this.path = path;
    this.parent = parent;
    this.last = segs[segs.length - 1];
    const lists: (Pattern | null)[] = [null];
    let depth = 0;
    let lastWildcard = -1;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] === WILDCARD) {
        depth++;
        lastWildcard = i;
      }
    }
    this.depth = depth;
    this.tail = segs.slice(lastWildcard + 1);
    // inherit the parent's list table and add our own when we are a wildcard segment
    if (parent) {
      for (let k = 1; k < parent.lists.length; k++) lists.push(parent.lists[k]);
    }
    if (this.last === WILDCARD) lists.push(parent);
    this.lists = lists;
  }

  addDependent(getter: Pattern): void {
    if (this.dependentSet.has(getter)) return;
    this.dependentSet.add(getter);
    this.dependents.push(getter);
    getter.sources.push(this);
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
/** Sentinel for "evaluated, but it threw": someone read it, so a change of its sources must reach it. */
export const FAILED: unique symbol = Symbol("failed") as never;

export class PatternTable {
  private readonly byPath = new Map<string, Pattern>();
  private nextId = 0;
  readonly root: Pattern[] = [];
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
    const segs = path.split(".");
    const parent = segs.length > 1 ? this.get(segs.slice(0, -1).join(".")) : null;
    p = new Pattern(this.nextId++, path, segs, parent);
    this.byPath.set(path, p);
    if (parent) parent.children.push(p); else this.root.push(p);
    this.onCreate?.(p);
    return p;
  }

  has(path: string): boolean {
    return this.byPath.has(path);
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
  let hasDigitSegment = false;
  const segs = path.split(".");
  for (let i = 0; i < segs.length; i++) {
    const c = segs[i].charCodeAt(0);
    if (c >= 48 && c <= 57) { hasDigitSegment = true; break; }
  }
  if (!hasDigitSegment) {
    const parsed: ParsedPath = { pattern: path, indexes: null };
    // literal paths (no explicit index) are few and reused: keep them
    literalCache.set(path, parsed);
    return parsed;
  }
  const indexes: number[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === WILDCARD) {
      indexes.push(-1);
    } else {
      const c = s.charCodeAt(0);
      if (c >= 48 && c <= 57) {
        indexes.push(Number(s));
        segs[i] = WILDCARD;
      }
    }
  }
  return { pattern: segs.join("."), indexes };
}
