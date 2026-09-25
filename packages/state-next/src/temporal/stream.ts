/**
 * `$stream` — an async producer folded into one reactive property (README "Streams",
 * packages/state/docs/streams.md).
 *
 * `args` runs as a getter of its own (a pattern with no path in the state), so the paths it reads
 * are tracked like any getter's; a change that reaches it restarts the stream at the end of the
 * drain, once (switchMap: abort, reset to `initial`, re-run `args`, call `source`). Its
 * dependencies are captured afresh on every run. `$streamStatus.<name>` / `$streamError.<name>`
 * are read-only companions kept on the state.
 */
import type { Engine } from "../engine";
import { FAILED, UNSET, type Pattern } from "../pattern";
import { raiseError } from "../parser/raiseError";

type Status = "idle" | "active" | "done" | "error";

interface Entry {
  readonly name: string;
  readonly source: (args: unknown, signal: AbortSignal) => unknown;
  readonly fold: ((acc: unknown, chunk: unknown) => unknown) | undefined;
  readonly initial: unknown;
  /** The `args` getter (null without args: start once). */
  readonly g: Pattern | null;
  readonly args: (() => unknown) | null;
  controller: AbortController | null;
  restart: boolean;
}

const STATUS = "$streamStatus";
const ERROR = "$streamError";
const PROTOTYPE_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));

/** A read-only companion path is being written by the runtime itself. */
export let internalWrite = false;

function hasAccessorOrMethod(target: object, name: string): boolean {
  for (let o: object | null = target; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d !== undefined) return d.get !== undefined || d.set !== undefined || typeof d.value === "function";
  }
  return false;
}

/** Validates `$stream` and materializes the value property and the companions on `target`. */
export function parseStreams(engine: Engine, target: Record<string, any>): Entry[] {
  const decl = target.$stream;
  if (target.$streams !== undefined) raiseError("[wcs/declaration-alias] $streams was removed: write $stream.");
  if (decl === undefined) return [];
  if (decl === null || typeof decl !== "object") raiseError("$stream must be an object mapping stream names to definitions.");
  const entries: Entry[] = [];
  const status: Record<string, Status> = {};
  const errors: Record<string, unknown> = {};
  for (const name of Object.keys(decl)) {
    // the author's object: read by quoted keys (the build shortens internal property names)
    const def = decl[name];
    if (name === "" || name[0] === "$" || /[.*]/.test(name) || PROTOTYPE_NAMES.has(name)) raiseError(`$stream entry "${name}" must be a flat property name.`);
    if (def === null || typeof def !== "object") raiseError(`$stream entry "${name}" must be an object.`);
    const source = def["source"];
    const fold = def["fold"];
    const args = def["args"];
    const initial = def["initial"];
    if (typeof source !== "function") raiseError(`$stream entry "${name}" needs a source function.`);
    if (fold !== undefined && typeof fold !== "function") raiseError(`$stream entry "${name}": fold must be a function.`);
    if (fold !== undefined && !("initial" in def)) raiseError(`$stream entry "${name}": fold needs an initial value.`);
    if (args !== undefined && typeof args !== "function") raiseError(`$stream entry "${name}": args must be a function.`);
    if (hasAccessorOrMethod(target, name)) raiseError(`$stream entry "${name}" collides with a getter, setter or method of the state.`);
    if (target[name] === undefined) target[name] = initial;
    status[name] = "idle";
    errors[name] = null;
    entries.push({
      name, source, fold, initial, controller: null, restart: false,
      g: args === undefined ? null : engine.pattern(`$streamArgs.${name}`),
      args: args === undefined ? null : function (this: unknown) { return args(this); },
    });
  }
  target[STATUS] = status;
  target[ERROR] = errors;
  return entries;
}

export class StreamRuntime {
  readonly engine: Engine;
  readonly entries: Entry[];

  constructor(engine: Engine, entries: Entry[]) {
    this.engine = engine;
    this.entries = entries;
  }

  private set(ns: string, name: string, value: unknown): void {
    internalWrite = true;
    try {
      this.engine.write(this.engine.pattern(`${ns}.${name}`), null, value);
    } finally {
      internalWrite = false;
    }
  }

  /** Eager start after `$connectedCallback`: an `args` failure is thrown as is. */
  startAll(): void {
    for (const e of this.entries) this.start(e, true);
  }

  /** A re-set replaced the state: the old runs stop without touching the new state. */
  abortAll(): void {
    for (const e of this.entries) {
      e.restart = false;
      e.controller?.abort();
      e.controller = null;
    }
  }

  stopAll(): void {
    for (const e of this.entries) {
      e.restart = false;
      if (e.controller !== null) {
        e.controller.abort();
        e.controller = null;
      }
      this.set(STATUS, e.name, "idle");
    }
  }

  getterReached(g: Pattern): void {
    for (const e of this.entries) if (e.g === g) e.restart = true;
  }

  /** At the end of a drain (after the watches): each stream whose `args` inputs changed restarts once. */
  drained(): void {
    for (const e of this.entries) {
      if (!e.restart) continue;
      e.restart = false;
      this.start(e, false);
    }
  }

  private start(e: Entry, eager: boolean): void {
    const engine = this.engine;
    if (e.controller !== null) e.controller.abort();
    e.controller = null;
    let args: unknown;
    if (e.g !== null) {
      const g = e.g;
      // (re)attached on every start: a re-set forgets every accessor of the old state
      g.getter = e.args;
      const kept = g.sources.slice();
      untrack(g);
      try {
        args = engine.read(g, null);
        checkArgs(e.name, g, args);
      } catch (error) {
        // the dependencies of the last successful run stay: touching one retries
        untrack(g);
        for (const s of kept) s.addDependent(g);
        g.rootValue = FAILED;
        if (eager) throw error;
        this.set(ERROR, e.name, error);
        this.set(STATUS, e.name, "error");
        return;
      }
    }
    const ctrl = new AbortController();
    e.controller = ctrl;
    engine.write(engine.pattern(e.name), null, e.initial);
    this.set(ERROR, e.name, null);
    this.set(STATUS, e.name, "active");
    void this.consume(e, ctrl, args);
  }

  private async consume(e: Entry, ctrl: AbortController, args: unknown): Promise<void> {
    const engine = this.engine;
    const signal = ctrl.signal;
    const live = (): boolean => !signal.aborted && e.controller === ctrl;
    const p = engine.pattern(e.name);
    let acc = e.initial;
    try {
      const producer: any = await e.source(args, signal);
      if (!live()) return;
      const chunk = (v: unknown): void => {
        acc = e.fold !== undefined ? e.fold(acc, v) : v;
        engine.write(p, null, acc);
      };
      if (producer !== null && typeof producer?.getReader === "function") {
        // a ReadableStream: only reader.cancel() can unwind a parked read
        const reader = producer.getReader();
        signal.addEventListener("abort", () => { reader.cancel().catch(() => {}); });
        for (;;) {
          const r = await reader.read();
          if (!live()) return;
          if (r.done) break;
          chunk(r.value);
        }
      } else if (producer !== null && typeof producer?.[Symbol.asyncIterator] === "function") {
        const it = producer[Symbol.asyncIterator]();
        signal.addEventListener("abort", () => { void it.return?.(); });
        for (;;) {
          const r = await it.next();
          if (!live()) return;
          if (r.done) break;
          chunk(r.value);
        }
      } else {
        throw new TypeError(`$stream "${e.name}": source must return an async iterable or a ReadableStream`);
      }
      if (!live()) return;
      e.controller = null;
      this.set(STATUS, e.name, "done");
    } catch (error) {
      if (!live()) return;
      e.controller = null;
      ctrl.abort();
      this.set(ERROR, e.name, error);
      this.set(STATUS, e.name, "error");
    }
  }
}

/** Forgets what a getter read (its dependencies are captured again by the next evaluation). */
function untrack(g: Pattern): void {
  for (const s of g.sources) {
    const i = s.dependents.indexOf(g);
    if (i >= 0) s.dependents.splice(i, 1);
    (s as any).dependentSet.delete(g);
  }
  g.sources.length = 0;
  g.rootValue = UNSET;
}

function checkArgs(name: string, g: Pattern, args: unknown): void {
  if (args !== null && typeof (args as any)?.then === "function") raiseError(`$stream "${name}": args must be synchronous (it returned a Promise).`);
  for (const s of g.sources) {
    if (s.depth > 0) raiseError(`$stream "${name}": args must not read a wildcard path ("${s.path}").`);
    if (s.path === name || s.path === `${STATUS}.${name}` || s.path === `${ERROR}.${name}`) raiseError(`$stream "${name}": args must not read the stream itself ("${s.path}").`);
  }
}
