import type { Engine } from "../engine";
import { DIRTY, FAILED, UNSET, type Pattern } from "../pattern";
import type { StateRow } from "../list";
import type { Strategy } from "./types";

/**
 * Push invalidation: a write walks its dependents immediately, marks their caches
 * DIRTY and queues their bindings. A cache already DIRTY (or never computed) stops the
 * walk — whatever depends on it was reached when it was marked.
 */
export class DirtyStrategy implements Strategy {
  readonly name = "dirty";

  private readonly mark = (g: Pattern, row: StateRow | null): boolean => {
    // UNSET: nobody read it; DIRTY: already reached. FAILED was read (and threw): reach it.
    if (g.depth === 0) {
      const v = g.rootValue;
      if (v === UNSET || v === DIRTY) return false;
      g.rootValue = DIRTY;
      return true;
    }
    const c = row === null ? null : row.cache;
    if (c === null) return false;
    const v = c[g.slot];
    if (v === UNSET || v === DIRTY) return false;
    c[g.slot] = DIRTY;
    return true;
  };

  onWrite(engine: Engine, p: Pattern, row: StateRow | null): void {
    if (p.getter !== null) {
      // a write through a getter's setter: the written occurrence itself is stale
      this.force(p, row);
      engine.enqueueBound(p, row);
      engine.walkDependents(p, row, this.mark);
      return;
    }
    engine.walkChange(p, row, this.mark);
  }

  onIndexChange(engine: Engine, row: StateRow): void {
    const watchers = row.list.pattern.indexWatchers;
    if (watchers === null) return;
    for (const g of watchers) {
      if (g.depth === row.list.depth) engine.visitGetter(g, row, this.mark);
      else engine.forRowsUnder(row, g, (r) => engine.visitGetter(g, r, this.mark));
    }
  }

  invalidate(engine: Engine, g: Pattern, row: StateRow | null): void {
    this.force(g, row);
    engine.enqueueBound(g, row);
    engine.walkDependents(g, row, this.mark);
  }

  private force(g: Pattern, row: StateRow | null): void {
    if (g.depth === 0) {
      if (g.rootValue !== UNSET) g.rootValue = DIRTY;
    } else if (row !== null && row.cache !== null) {
      if (row.cache[g.slot] !== UNSET) row.cache[g.slot] = DIRTY;
    }
  }

  readGetter(engine: Engine, g: Pattern, row: StateRow | null): unknown {
    if (g.depth === 0) {
      let v = g.rootValue;
      if (v !== UNSET && v !== DIRTY && v !== FAILED) return v;
      try {
        v = engine.evalGetter(g, null);
      } catch (e) {
        g.rootValue = FAILED;
        throw e;
      }
      g.rootValue = v;
      return v;
    }
    if (row === null) return undefined;
    let c = row.cache;
    if (c === null) c = row.cache = new Array(engine.slotCount).fill(UNSET);
    let v = c[g.slot];
    if (v !== UNSET && v !== DIRTY && v !== FAILED) return v;
    try {
      v = engine.evalGetter(g, row);
    } catch (e) {
      c[g.slot] = FAILED;
      throw e;
    }
    c[g.slot] = v;
    return v;
  }

  beforeDrain(): void {}

  pending(): boolean {
    return false;
  }

  resetRow(row: StateRow): void {
    row.cache = null;
  }
}
