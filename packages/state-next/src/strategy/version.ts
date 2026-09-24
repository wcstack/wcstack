import { rowAt, type Engine } from "../engine";
import { UNSET, type Pattern } from "../pattern";
import type { StateRow } from "../list";
import type { Strategy } from "./types";

const WRITE = 0;
const INDEX = 1;
const FORCE = 2;

/**
 * Pull validation: a write stamps a global clock on the written pattern (and on its
 * row) and queues itself. A cached getter read compares the clock at which it was
 * computed with the clocks of every pattern it has ever read (and of its row); newer
 * means recompute. The walk that finds the bindings to re-apply runs once per drain.
 */
export class VersionStrategy implements Strategy {
  readonly name = "version";
  private kinds: number[] = [];
  private pats: (Pattern | null)[] = [];
  private rows: (StateRow | null)[] = [];
  private engine: Engine | null = null;

  /** De-duplicates a getter occurrence per drain pass. */
  private readonly visit = (g: Pattern, row: StateRow | null): boolean => {
    const epoch = this.engine!.epoch;
    if (g.depth === 0) {
      if (g.seenEpoch === epoch) return false;
      g.seenEpoch = epoch;
      return true;
    }
    if (row === null) return false;
    const s = row.seenAt ?? (row.seenAt = []);
    if (s[g.slot] === epoch) return false;
    s[g.slot] = epoch;
    return true;
  };

  onWrite(engine: Engine, p: Pattern, row: StateRow | null): void {
    const t = ++engine.clock;
    p.ver = t;
    if (row !== null) row.clock = t;
    if (p.getter !== null) this.force(p, row);
    this.push(WRITE, p, row);
  }

  onIndexChange(engine: Engine, row: StateRow): void {
    row.clock = ++engine.clock;
    if (row.list.pattern.indexWatchers !== null) this.push(INDEX, null, row);
  }

  invalidate(_engine: Engine, g: Pattern, row: StateRow | null): void {
    this.force(g, row);
    this.push(FORCE, g, row);
  }

  private push(kind: number, p: Pattern | null, row: StateRow | null): void {
    this.kinds.push(kind);
    this.pats.push(p);
    this.rows.push(row);
  }

  private force(g: Pattern, row: StateRow | null): void {
    if (g.depth === 0) g.rootAt = -1;
    else if (row !== null && row.cacheAt !== null) row.cacheAt[g.slot] = -1;
  }

  beforeDrain(engine: Engine): void {
    if (this.kinds.length === 0) return;
    this.engine = engine;
    const kinds = this.kinds;
    const pats = this.pats;
    const rows = this.rows;
    this.kinds = [];
    this.pats = [];
    this.rows = [];
    for (let i = 0; i < kinds.length; i++) {
      const p = pats[i];
      const row = rows[i];
      switch (kinds[i]) {
        case WRITE:
          if (p!.getter !== null) {
            engine.enqueueBound(p!, row);
            engine.walkDependents(p!, row, this.visit);
          } else {
            engine.walkChange(p!, row, this.visit);
          }
          break;
        case INDEX:
          for (const g of row!.list.pattern.indexWatchers!) {
            if (g.depth === row!.list.depth) engine.visitGetter(g, row, this.visit);
            else engine.forRowsUnder(row!, g, (r) => engine.visitGetter(g, r, this.visit));
          }
          break;
        case FORCE:
          engine.enqueueBound(p!, row);
          engine.walkDependents(p!, row, this.visit);
          break;
      }
    }
  }

  pending(): boolean {
    return this.kinds.length > 0;
  }

  readGetter(engine: Engine, g: Pattern, row: StateRow | null): unknown {
    if (g.depth === 0) {
      if (g.rootAt >= 0 && g.rootValue !== UNSET && !this.stale(engine, g, g.rootAt, null)) return g.rootValue;
      const old = g.rootValue;
      const v = engine.evalGetter(g, null);
      g.rootValue = v;
      g.rootAt = engine.clock;
      if (old !== UNSET && !Object.is(old, v)) g.ver = ++engine.clock;
      return v;
    }
    if (row === null) return undefined;
    const at = row.cacheAt === null ? undefined : row.cacheAt[g.slot];
    if (at !== undefined && at >= 0 && row.clock <= at && !this.stale(engine, g, at, row)) return row.cache![g.slot];
    // never computed = UNSET (a forced invalidation keeps the old value to compare with)
    const old = row.cache === null ? UNSET : row.cache[g.slot];
    const v = engine.evalGetter(g, row);
    if (row.cache === null) {
      row.cache = new Array(engine.slotCount).fill(UNSET);
      row.cacheAt = new Array(engine.slotCount).fill(-1);
    }
    row.cache[g.slot] = v;
    row.cacheAt![g.slot] = engine.clock;
    if (old !== UNSET && !Object.is(old, v)) g.ver = ++engine.clock;
    return v;
  }

  /**
   * Has anything this getter ever read (or an ancestor of it) changed after `t`?
   * A source that is itself a getter is brought up to date first, so its `ver` says
   * when its value last changed (getters only bump `ver` when a recompute changes it).
   */
  private stale(engine: Engine, g: Pattern, t: number, row: StateRow | null): boolean {
    const src = g.sources;
    for (let i = 0; i < src.length; i++) {
      const q = src[i];
      if (q.getter !== null) {
        if (q.depth === 0) this.readGetter(engine, q, null);
        else if (row !== null && q.depth <= g.depth) {
          const r = rowAt(row, q.depth);
          if (r !== null) this.readGetter(engine, q, r);
        }
      }
      for (let p: Pattern | null = q; p !== null; p = p.parent) {
        if (p.ver > t) return true;
      }
    }
    return false;
  }

  resetRow(row: StateRow): void {
    row.cache = null;
    row.cacheAt = null;
  }
}

