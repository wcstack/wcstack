/**
 * `$watch` — the headless subscription (README "Watch", docs/state-watch-hook-design.md).
 *
 * A handler fires at the end of a drain, once per location that landed in it: a write of its
 * path or of an object above it in the same row, a change that reached its getter, a row that
 * entered its list. `cur` is the value at the drain; `prev` the value before the batch's first
 * write when a primitive was written (for a getter: its previous evaluation). A change that reaches
 * a getter fires it, whether its value changed or not (3.x D4: a watch has no condition of its own).
 * A row's getter that no write of the batch changed — it read none of the written paths, directly or
 * through a getter it read — fires only if its value changed: a row a list kept when a write
 * re-synced or re-sorted the list (`items = [...items, x]`) is reached again through what it read
 * under the row, which did not change (#389). A write at the list (or above it) changes what a row
 * read there (`this.items.length`), not under its row.
 * Declaration order between handlers, ascending indexes between rows of one path.
 *
 * A handler's writes form the next batch. Each write carries a chain depth (as @wcstack/state
 * 3.4, #354): 0, or one more than the depth of what fired the handler making it — or restarted the
 * `$stream` making it (stream.ts: its run's values and end too, within the task the run started in).
 * For a data path that is the deepest write landing there in the batch; for a getter, the first write
 * since it was last evaluated (a reached getter is not reached again until it is read), and 0 when a
 * list re-synced in the drain reached it — loops through those are left to the render chain
 * (MAX_RENDER_CHAIN). A handler fired more than MAX_CHAIN deep does not
 * run (as 3.x: 33 links run): the chain is cut and reported once. Writes riding in the same batch (a
 * render's write-back) neither lengthen nor reset it.
 *
 * Differences from @wcstack/state 3.3 that rows make possible: a row watch needs neither a
 * `for` binding nor `$listKeys` (the watch keeps its lists synced itself), wildcard getters are
 * eager too, and a whole-array assignment fires only for the rows that entered the list (a row
 * kept by identity did not change).
 */
import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { StateList, StateRow } from "../list";
import { raiseError } from "../parser/raiseError";
import { hooks } from "../hooks";

type Handler = (this: unknown, cur: unknown, prev: unknown, ...indexes: number[]) => unknown;

interface Watch {
  readonly path: string;
  readonly p: Pattern;
  readonly handler: Handler;
  /** A getter (or under one): kept evaluated, `prev` is its previous evaluation. */
  getter: boolean;
  /** Previous evaluation by row (getter watches; the root's under ROOT): a removed row takes its entry with it. */
  last: WeakMap<object, unknown>;
}

/**
 * A landing of a batch: `prev` (the first write's), the deepest write's chain depth, and whether a
 * write landed there (not only a change that reached a getter).
 */
type Hit = [prev: unknown, depth: number, landed: boolean];

export const MAX_CHAIN = 32;
const ROOT = {};
/**
 * An explicit index (`items.0.v`, read like a getter): a write to another row, a list change,
 * reaches it unchanged. A leading numeric segment is a root key (`2024.total`), not an index.
 */
const INDEX_PATH = /\.\d/;
const PROTOTYPE_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));

/**
 * The current task's number, bumped in the next task after it is asked for: a MessageChannel message
 * (neither throttled in a background tab nor replaced by a faked timer), or a timer where there is none.
 */
let taskSeq = 0;
let pinged = false;
let ping: (() => void) | null = null;
const nextTask = (): void => {
  pinged = false;
  taskSeq++;
};
export function thisTask(): number {
  if (ping === null) {
    if (typeof MessageChannel === "function") {
      const ch = new MessageChannel();
      ch.port1.onmessage = nextTask;
      // (Node: the port must not keep the process alive)
      (ch.port1 as { unref?: () => void }).unref?.();
      ping = () => ch.port2.postMessage(0);
    } else ping = () => setTimeout(nextTask, 0);
  }
  if (!pinged) {
    pinged = true;
    ping();
  }
  return taskSeq;
}

/** Whether a write at a path of `changed` changed what getter `g` read (directly, or through a getter it read). */
function reads(g: Pattern, changed: Set<Pattern>): boolean {
  const seen = new Set<Pattern>();
  const stack = [g];
  while (stack.length > 0) {
    const h = stack.pop()!;
    if (seen.has(h)) continue;
    seen.add(h);
    for (const s of h.sources) {
      for (const p of changed) {
        // a write at the list a row is in (or above it) changes what was read there, not under the row
        if (s.isUnder(p) && (s.depth === p.depth || !(p.depth < h.depth && h.lists[p.depth + 1]!.isUnder(p)))) return true;
      }
      if (s.getter !== null) stack.push(s);
    }
  }
  return false;
}

export function parseWatches(engine: Engine, decl: unknown): Watch[] {
  if (decl === undefined) return [];
  if (decl === null || typeof decl !== "object") raiseError("$watch must be an object mapping paths to handler functions.");
  const out: Watch[] = [];
  for (const path of Object.keys(decl)) {
    const handler = (decl as Record<string, unknown>)[path];
    if (path === "" || path[0] === "$" || path.includes("@") || PROTOTYPE_NAMES.has(path)) raiseError(`$watch path "${path}" is not a path of the state tree.`);
    if (typeof handler !== "function") raiseError(`$watch entry "${path}" must be a function.`);
    const p = engine.pattern(path);
    hooks.declared?.(engine, p, true);
    out.push({ path, p, handler: handler as Handler, getter: false, last: new WeakMap() });
  }
  return out;
}

export class WatchRuntime {
  readonly engine: Engine;
  readonly watches: Watch[];
  active = false;
  /** Landings of the current batch: watch → row → hit. */
  private hits = new Map<Watch, Map<StateRow | null, Hit>>();
  /** The chain depth of a write made now: 0, or one more than what fired the running handler (or restart). */
  depth = 0;
  /**
   * The paths a cut reported in task `cutTask`. A chain carries its depth only synchronously (and
   * through a `$stream`'s values within the task its run started in): a cut of the same paths later
   * in the task is the same chain's — what it left running reaching the limit again.
   */
  private cutTask = -1;
  private reported = new Set<string>();
  /** The paths written in the batch (what a change reaching a getter may have come from). */
  private changed: Set<Pattern> | null = null;

  constructor(engine: Engine, watches: Watch[]) {
    this.engine = engine;
    this.watches = watches;
  }

  /** After `$connectedCallback` (and on reconnect): watches see the writes from now on. */
  activate(): void {
    const engine = this.engine;
    this.hits.clear();
    for (const w of this.watches) {
      w.getter = w.p.getter !== null || w.p.underGetter;
      w.last = new WeakMap();
      // (the list a row watch reads can be a getter that throws too)
      this.prime(w, () => {
        if (w.p.depth === 0) {
          if (w.getter) w.last.set(ROOT, engine.readUntracked(w.p, null));
        } else {
          // a row watch keeps its lists synced, rendered or not; a getter watch is eager per row
          this.eachRow(w.p, 1, null, (row) => {
            if (w.getter) this.prime(w, () => w.last.set(row, engine.readUntracked(w.p, row)));
          });
        }
      });
    }
    this.active = true;
  }

  /** What a watch reads before the writes (its `prev`): what throws is reported, the others go on. */
  private prime(w: Watch, read: () => void): void {
    try {
      read();
    } catch (error) {
      console.error(`[@wcstack/state] $watch initial evaluation of "${w.path}" threw.`, error);
      hooks.noticed?.(this.engine, { "type": "state:watch-error", "phase": "prime", "path": w.path, "error": error });
    }
  }

  deactivate(): void {
    this.active = false;
    this.hits.clear();
  }

  /** Calls fn for every row at p.depth, creating the lists on the way (they then stay synced). */
  private eachRow(p: Pattern, k: number, parent: StateRow | null, fn: (row: StateRow) => void): void {
    const engine = this.engine;
    const list = engine.childList(parent, p.lists[k]!);
    for (const row of list.rows) {
      if (k === p.depth) fn(row);
      else this.eachRow(p, k + 1, row, fn);
    }
  }

  /** Records a landing at the current depth: the first `prev` stays, the deepest write's depth wins. */
  private hit(w: Watch, row: StateRow | null, prev: unknown, landed: boolean): void {
    let rows = this.hits.get(w);
    if (rows === undefined) this.hits.set(w, (rows = new Map()));
    const h = rows.get(row);
    if (h === undefined) rows.set(row, [prev, this.depth, landed]);
    else {
      if (h[1] < this.depth) h[1] = this.depth;
      h[2] ||= landed;
    }
  }

  written(p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean): void {
    if (!this.active) return;
    (this.changed ??= new Set()).add(p);
    for (const w of this.watches) {
      const wp = w.p;
      // the watched path, or an object above it in the same row (a getter's row replaced included)
      if (wp.depth !== p.depth || !wp.isUnder(p)) continue;
      // `prev`: a getter's previous evaluation; for data, the old value the same-value guard reads
      // when a primitive was written there (none when it is off, or above it)
      this.hit(w, row, w.getter ? w.last.get(row ?? ROOT) : wp === p && direct && this.engine.guard && (value === null || (typeof value !== "object" && typeof value !== "function")) ? old : undefined, true);
    }
  }

  getterReached(g: Pattern, row: StateRow | null): void {
    if (!this.active) return;
    // a getter, or a path under it in the same row — also one that became so after the activation
    // (a mounted component's exported getter, a volume's accessor grafted later)
    for (const w of this.watches) {
      if ((w.getter ||= w.p.getter !== null || w.p.underGetter) && w.p.depth === g.depth && w.p.isUnder(g)) this.hit(w, row, w.last.get(row ?? ROOT), false);
    }
  }

  /** Rows that entered a list a row watch ranges over fire (and nested lists under them sync). */
  listSynced(list: StateList, old: StateRow[]): void {
    if (!this.active) return;
    let before: Set<StateRow> | null = null;
    for (const w of this.watches) {
      const wp = w.p;
      if (wp.depth < list.depth || wp.lists[list.depth] !== list.pattern) continue;
      before ??= new Set(old);
      for (const row of list.rows) {
        if (before.has(row)) continue;
        if (wp.depth === list.depth) this.hit(w, row, undefined, true);
        else this.eachRow(wp, list.depth + 1, row, (r) => this.hit(w, r, undefined, true));
      }
    }
  }

  drained(): void {
    const changed = this.changed;
    this.changed = null;
    if (!this.active || this.hits.size === 0) return;
    const batch = this.hits;
    this.hits = new Map();
    const engine = this.engine;
    const cut: string[] = [];
    for (const w of this.watches) {
      const rows = batch.get(w);
      if (rows === undefined) continue;
      const entries = [...rows].filter(([row]) => row === null || row.alive);
      if (entries.length > 1) entries.sort((a, b) => compareRows(a[0]!, b[0]!));
      // (whether a write of the batch changed what the watched getter read: asked once, for an unchanged row)
      let real: boolean | undefined;
      for (const [row, [prev, depth, landed]] of entries) {
        let cur: unknown;
        // (DevTools: the handler fired, or what threw — the value's evaluation or the handler)
        let phase = "evaluate";
        const saved = engine.ctx;
        this.depth = depth + 1;
        engine.feeding++;
        try {
          // (read past the limit too: a getter's cache is then current, and its next change reaches it)
          cur = engine.readUntracked(w.p, row);
          if (w.getter) {
            w.last.set(row ?? ROOT, cur);
            // unchanged: an explicit index, or a row no write of the batch changed (a row a list kept, #389)
            if (Object.is(cur, prev) && (INDEX_PATH.test(w.path) || (row !== null && !landed && !(real ??= changed !== null && reads(getterOf(w.p), changed))))) continue;
          }
          // fired more than MAX_CHAIN deep: the chain stops here (the batch's other handlers run)
          if (depth > MAX_CHAIN) {
            if (!cut.includes(w.path)) cut.push(w.path);
            continue;
          }
          engine.ctx = row;
          hooks.noticed?.(engine, { "type": "state:watch-fired", "path": w.path });
          phase = "handler";
          w.handler.call(engine.proxy, cur, prev, ...engine.indexesOf(row));
        } catch (error) {
          console.error(`[@wcstack/state] $watch "${w.path}" failed; the other watches still run.`, error);
          hooks.noticed?.(engine, { "type": "state:watch-error", "phase": phase, "path": w.path, "error": error });
        } finally {
          engine.ctx = saved;
          this.depth = 0;
          engine.feeding--;
        }
      }
    }
    if (cut.length > 0) this.chainCut(cut);
  }

  /** A chain of handlers / stream restarts went past MAX_CHAIN: reported once a task for its paths (nothing is rolled back). */
  chainCut(paths: string[]): void {
    const task = thisTask();
    if (task !== this.cutTask) {
      this.cutTask = task;
      this.reported.clear();
    }
    const fresh = paths.filter((path) => !this.reported.has(path));
    if (fresh.length === 0) return;
    for (const path of fresh) this.reported.add(path);
    console.error(`[@wcstack/state] $watch handlers / $stream restarts kept writing for ${MAX_CHAIN} batches; the chain is cut (nothing is rolled back).`);
    hooks.noticed?.(this.engine, { "type": "state:watch-chain-limit", "maxDepth": MAX_CHAIN, "paths": fresh });
  }
}

/** The getter a watched path is, or lies under (in the same row). */
function getterOf(p: Pattern): Pattern {
  while (p.getter === null && p.parent !== null) p = p.parent;
  return p;
}

/** Ascending indexes, outermost first. */
function compareRows(a: StateRow, b: StateRow): number {
  const ia: number[] = [];
  const ib: number[] = [];
  for (let r: StateRow | null = a; r !== null; r = r.list.parentRow) ia.unshift(r.index);
  for (let r: StateRow | null = b; r !== null; r = r.list.parentRow) ib.unshift(r.index);
  for (let i = 0; i < ia.length && i < ib.length; i++) if (ia[i] !== ib[i]) return ia[i] - ib[i];
  return ia.length - ib.length;
}
