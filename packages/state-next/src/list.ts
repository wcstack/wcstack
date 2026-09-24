import type { Pattern } from "./pattern";
import type { Binding, ForView, RowView } from "./dom/view";

/**
 * One element of a list, owned by its StateList. The row is the whole address of
 * everything under `list.*`: the value (`item`), the position (`index`), the getter
 * cache and the bindings that render it hang off this object — no ledger keyed by an
 * address. Dropping the row drops all of it.
 */
export class StateRow {
  readonly list: StateList;
  index: number;
  item: unknown;
  /** Getter cache by slot (row-level getters of this engine). */
  cache: unknown[] | null = null;
  /** Version strategy: write clock at which each slot was computed. */
  cacheAt: number[] | null = null;
  /** Version strategy: last write inside this row, or last change of its position. */
  clock = 0;
  /** Version strategy: per-drain walk de-duplication by slot. */
  seenAt: number[] | null = null;
  /** The rendering of this row (one view per list in this engine). */
  view: RowView | null = null;
  /** Bindings whose location is in this row (pattern depth = this row's depth), wherever they render. */
  bindings: Binding[] | null = null;
  /** `$eq` subscriptions of getters evaluated at this row (dropped with the row). */
  eqSubs: { source: Pattern; key: unknown; sub: import("./pattern").EqSub }[] | null = null;
  /** Nested lists under this row, by list pattern. */
  children: Map<Pattern, StateList> | null = null;
  alive = true;

  constructor(list: StateList, index: number, item: unknown) {
    this.list = list;
    this.index = index;
    this.item = item;
  }

  get parent(): StateRow | null {
    return this.list.parentRow;
  }

  get depth(): number {
    return this.list.depth;
  }
}

export class StateList {
  readonly pattern: Pattern;
  readonly parentRow: StateRow | null;
  /** Depth of this list's rows (1 for a root list). */
  readonly depth: number;
  /** The array the rows were last reconciled against. */
  arr: unknown[] | null = null;
  rows: StateRow[] = [];
  /** The for-view that renders this list, if any. */
  view: ForView | null = null;
  /** Queued for a view update in the current drain. */
  queued = false;

  constructor(pattern: Pattern, parentRow: StateRow | null) {
    this.pattern = pattern;
    this.parentRow = parentRow;
    this.depth = pattern.depth + 1;
  }
}

export interface ReconcileHooks {
  /** A kept row changed position. */
  indexChanged(row: StateRow): void;
  /** A row left the list. */
  rowRemoved(row: StateRow): void;
}

type Bucket = StateRow | StateRow[];

/**
 * Brings `list.rows` in line with `next`, reusing rows by item identity.
 * Returns the previous rows (for $eqIndex re-keying) or null when nothing changed.
 * DOM is not touched here; the list's view catches up in the drain.
 */
export function reconcile(list: StateList, next: unknown, hooks: ReconcileHooks): StateRow[] | null {
  const arr = Array.isArray(next) ? next : EMPTY;
  if (arr === list.arr) return null;
  const old = list.rows;
  const n = arr.length;
  const o = old.length;
  const rows: StateRow[] = new Array(n);

  let start = 0;
  while (start < n && start < o && old[start].item === arr[start]) {
    rows[start] = old[start];
    start++;
  }
  let oe = o - 1;
  let ne = n - 1;
  while (oe >= start && ne >= start && old[oe].item === arr[ne]) {
    rows[ne] = old[oe];
    oe--;
    ne--;
  }

  if (start > oe) {
    for (let i = start; i <= ne; i++) rows[i] = new StateRow(list, i, arr[i]);
  } else if (start > ne) {
    for (let i = start; i <= oe; i++) {
      old[i].alive = false;
      hooks.rowRemoved(old[i]);
    }
  } else {
    const byItem = new Map<unknown, Bucket>();
    for (let i = start; i <= oe; i++) {
      const row = old[i];
      const b = byItem.get(row.item);
      if (b === undefined) byItem.set(row.item, row);
      else if (Array.isArray(b)) b.push(row);
      else byItem.set(row.item, [b, row]);
    }
    for (let i = start; i <= ne; i++) {
      const item = arr[i];
      const b = byItem.get(item);
      let row: StateRow | undefined;
      if (b !== undefined) {
        if (Array.isArray(b)) {
          row = b.shift();
          if (b.length === 0) byItem.delete(item);
        } else {
          row = b;
          byItem.delete(item);
        }
      }
      rows[i] = row ?? new StateRow(list, i, item);
    }
    for (const b of byItem.values()) {
      if (Array.isArray(b)) {
        for (const r of b) {
          r.alive = false;
          hooks.rowRemoved(r);
        }
      } else {
        b.alive = false;
        hooks.rowRemoved(b);
      }
    }
  }

  // positions: only rows from `start` on can have moved
  for (let i = start; i < n; i++) {
    const row = rows[i];
    if (row.index !== i) {
      row.index = i;
      hooks.indexChanged(row);
    }
  }
  list.rows = rows;
  list.arr = arr;
  return old;
}

const EMPTY: unknown[] = [];
