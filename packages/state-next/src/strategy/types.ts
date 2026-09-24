import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { StateRow } from "../list";

/**
 * How getter caches stay consistent with writes ("read after write"). The one strategy is
 * dirty (spike-results.ja.md): a write walks its dependents at once, marks their caches
 * stale and queues their bindings; a read of a stale cache recomputes.
 */
export interface Strategy {
  readonly name: string;
  /** A write to pattern `p` at `row` (null at the root) has been applied to the data. */
  onWrite(engine: Engine, p: Pattern, row: StateRow | null): void;
  /** A kept row changed position. */
  onIndexChange(engine: Engine, row: StateRow): void;
  /** Invalidate one getter occurrence regardless of its sources ($eqIndex re-keying). */
  invalidate(engine: Engine, getter: Pattern, row: StateRow | null): void;
  /** Cached read of a getter occurrence. */
  readGetter(engine: Engine, getter: Pattern, row: StateRow | null): unknown;
  /** The element under a row was replaced: forget the row's cached values. */
  resetRow(row: StateRow): void;
}
