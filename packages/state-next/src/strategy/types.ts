import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { StateRow } from "../list";

/**
 * How getter caches stay consistent with writes ("read after write").
 *
 * - dirty: a write walks its dependents at once, marks their caches stale and queues
 *   their bindings. A read of a stale cache recomputes.
 * - version: a write only stamps a clock and queues itself; the walk that finds the
 *   bindings to re-apply runs once in the drain. A cached read validates itself against
 *   the clocks of what it read.
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
  /** Called at the start of every drain pass. */
  beforeDrain(engine: Engine): void;
  /** Work queued by writes that the drain has not processed yet. */
  pending(engine: Engine): boolean;
  /** The element under a row was replaced: forget the row's cached values. */
  resetRow(row: StateRow): void;
}
