import type { Engine } from "../engine";
import { DIRTY, FAILED, UNSET, type Pattern } from "../pattern";
import type { StateRow } from "../list";
import type { Strategy } from "./types";
import { hooks } from "../hooks";

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
    // a write through a getter's setter: the written occurrence itself is stale
    if (p.getter !== null) this.mark(p, row);
    engine.enqueueBound(p, row);
    engine.walkDependents(p, row, this.mark);
  }

  onIndexChange(engine: Engine, row: StateRow): void {
    const watchers = row.list.pattern.indexWatchers;
    if (watchers === null) return;
    for (const g of watchers) {
      // the row itself (a row getter reading its own index): no closure per moved row
      if (g.depth === row.list.depth) engine.visitGetter(g, row, this.mark);
      else engine.forRowsUnder(row, g, (r) => engine.visitGetter(g, r, this.mark));
    }
  }

  invalidate(engine: Engine, g: Pattern, row: StateRow | null): void {
    this.mark(g, row);
    hooks.getterReached?.(engine, g, row);
    engine.enqueueBound(g, row);
    engine.walkDependents(g, row, this.mark);
  }

  readGetter(engine: Engine, g: Pattern, row: StateRow | null): unknown {
    const root = g.depth === 0;
    if (!root && row === null) return undefined;
    const c = root ? null : (row!.cache ??= new Array(engine.slotCount).fill(UNSET));
    let v = c === null ? g.rootValue : c[g.slot];
    // a getter made after the row's cache (a recursive family, a mounted key, a binder's subtree) has
    // no entry yet — nor one whose slot lies before a later getter's written past the end (a hole)
    if (v !== UNSET && v !== DIRTY && v !== FAILED && (c === null || g.slot in c)) return v;
    v = FAILED;
    try {
      return (v = engine.evalGetter(g, c === null ? null : row));
    } finally {
      if (c === null) g.rootValue = v;
      else c[g.slot] = v;
    }
  }

  resetRow(row: StateRow): void {
    row.cache = null;
  }

  dropped(engine: Engine): void {
    // DIRTY says "its readers were reached", and they were dropped: FAILED is reached again
    for (const g of engine.patterns.all()) {
      if (g.getter === null) continue;
      if (g.depth === 0) {
        if (g.rootValue === DIRTY) g.rootValue = FAILED;
      } else {
        engine.forAllRows(g.lists[g.depth]!, (r) => {
          const c = r.cache;
          if (c !== null && c[g.slot] === DIRTY) c[g.slot] = FAILED;
        });
      }
    }
  }
}
