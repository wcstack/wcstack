/**
 * `$watch` — the headless subscription (README "Watch", docs/state-watch-hook-design.md).
 *
 * A handler fires at the end of a drain, once per location that landed in it: a write of its
 * path or of an object above it in the same row, a change that reached its getter, a row that
 * entered its list. `cur` is the value at the drain; `prev` the value before the batch's first
 * write when a primitive was written (for a getter: its previous evaluation). Declaration order
 * between handlers, ascending indexes between rows of one path. A handler's writes form the next
 * batch; a chain of such batches is cut after 32.
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
  /** Previous evaluation by row (getter watches). */
  readonly last: Map<StateRow | null, unknown>;
}

const MAX_CHAIN = 32;
const PROTOTYPE_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));

export function parseWatches(engine: Engine, decl: unknown): Watch[] {
  if (decl === undefined) return [];
  if (decl === null || typeof decl !== "object") raiseError("$watch must be an object mapping paths to handler functions.");
  const out: Watch[] = [];
  for (const path of Object.keys(decl)) {
    const handler = (decl as Record<string, unknown>)[path];
    if (path === "" || path[0] === "$" || path.includes("@") || PROTOTYPE_NAMES.has(path)) raiseError(`$watch path "${path}" is not a path of the state tree.`);
    if (typeof handler !== "function") raiseError(`$watch entry "${path}" must be a function.`);
    const p = engine.pattern(path);
    if (hooks.declared !== null) hooks.declared(engine, p, true);
    out.push({ path, p, handler: handler as Handler, getter: false, last: new Map() });
  }
  return out;
}

export class WatchRuntime {
  readonly engine: Engine;
  readonly watches: Watch[];
  active = false;
  /** Landings of the current batch: watch → row → prev (first write wins). */
  private hits = new Map<Watch, Map<StateRow | null, unknown>>();
  private chain = 0;
  /** A handler wrote: the next drain continues a chain. */
  private handlerWrote = false;
  private inHandler = false;

  constructor(engine: Engine, watches: Watch[]) {
    this.engine = engine;
    this.watches = watches;
  }

  /** After `$connectedCallback` (and on reconnect): watches see the writes from now on. */
  activate(): void {
    const engine = this.engine;
    this.hits.clear();
    this.chain = 0;
    for (const w of this.watches) {
      w.getter = w.p.getter !== null || w.p.underGetter;
      w.last.clear();
      if (w.p.depth === 0) {
        if (w.getter) w.last.set(null, engine.readUntracked(w.p, null));
      } else {
        // a row watch keeps its lists synced, rendered or not; a getter watch is eager per row
        this.eachRow(w.p, 1, null, (row) => {
          if (w.getter) w.last.set(row, engine.readUntracked(w.p, row));
        });
      }
    }
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
    this.hits.clear();
  }

  /** Calls fn for every row at p.depth, creating the lists on the way (they then stay synced). */
  private eachRow(p: Pattern, k: number, parent: StateRow | null, fn: (row: StateRow) => void): void {
    const engine = this.engine;
    const list = k === 1 ? engine.rootList(p.lists[1]!) : engine.childList(parent!, p.lists[k]!);
    for (const row of list.rows) {
      if (k === p.depth) fn(row);
      else this.eachRow(p, k + 1, row, fn);
    }
  }

  private hit(w: Watch, row: StateRow | null, prev: unknown): void {
    let rows = this.hits.get(w);
    if (rows === undefined) this.hits.set(w, (rows = new Map()));
    if (!rows.has(row)) rows.set(row, prev);
  }

  written(p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean): void {
    if (this.inHandler) this.handlerWrote = true;
    if (!this.active) return;
    for (const w of this.watches) {
      if (w.getter) continue;
      const wp = w.p;
      if (wp === p) {
        this.hit(w, row, direct && (value === null || (typeof value !== "object" && typeof value !== "function")) ? old : undefined);
      } else if (wp.depth === p.depth && wp.isUnder(p)) {
        // an object above the watched path in the same row was replaced (no primitive written: no prev)
        this.hit(w, row, undefined);
      }
    }
  }

  getterReached(g: Pattern, row: StateRow | null): void {
    if (!this.active) return;
    for (const w of this.watches) if (w.getter && w.p === g) this.hit(w, row, w.last.get(row));
  }

  /** Rows that entered a list a row watch ranges over fire (and nested lists under them sync). */
  listSynced(list: StateList, old: StateRow[]): void {
    if (!this.active) return;
    const before = new Set(old);
    for (const w of this.watches) {
      const wp = w.p;
      if (wp.depth < list.depth || wp.lists[list.depth] !== list.pattern) continue;
      for (const row of list.rows) {
        if (before.has(row)) continue;
        if (wp.depth === list.depth) this.hit(w, row, undefined);
        else this.eachRow(wp, list.depth + 1, row, (r) => this.hit(w, r, undefined));
      }
    }
  }

  drained(): void {
    const chained = this.handlerWrote;
    this.handlerWrote = false;
    if (!this.active || this.hits.size === 0) {
      if (!chained) this.chain = 0;
      return;
    }
    const batch = this.hits;
    this.hits = new Map();
    this.chain = chained ? this.chain + 1 : 0;
    if (this.chain >= MAX_CHAIN) {
      console.error(`[@wcstack/state] $watch handlers kept writing for ${MAX_CHAIN} batches; the chain is cut (nothing is rolled back).`);
      this.chain = 0;
      return;
    }
    const engine = this.engine;
    for (const w of this.watches) {
      const rows = batch.get(w);
      if (rows === undefined) continue;
      const entries = [...rows].filter(([row]) => row === null || row.alive);
      if (entries.length > 1) entries.sort((a, b) => compareRows(a[0]!, b[0]!));
      for (const [row, prev] of entries) {
        let cur: unknown;
        const saved = engine.ctx;
        this.inHandler = true;
        try {
          cur = engine.readUntracked(w.p, row);
          if (w.getter) w.last.set(row, cur);
          engine.ctx = row;
          w.handler.call(engine.proxy, cur, prev, ...engine.indexesOf(row));
        } catch (error) {
          console.error(`[@wcstack/state] $watch "${w.path}" failed; the other watches still run.`, error);
        } finally {
          engine.ctx = saved;
          this.inHandler = false;
        }
      }
    }
  }
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
