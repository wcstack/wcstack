/**
 * Recursive paths (README "Recursive paths"): one self-recursive anchor per state,
 * `$recursion: { "nodes.*": "children.*" }`, and `**` as a depth variable — `nodes.**.x` stands
 * for `nodes.*.x`, `nodes.*.children.*.x`, … The engine only ever sees the concrete depths:
 *
 * - a getter `get "nodes.**.total"()` is a family, materialized as an ordinary getter on each
 *   concrete depth's pattern when that pattern is made (so `$1`, caching and dependencies are the
 *   ordinary per-depth ones, and a deep change reaches every ancestor through ordinary edges);
 * - `**` in a path read or `$getAll(path)` without indexes is bound to the depth of the row the
 *   evaluation runs in (a family getter's row, a row getter's, an event handler's);
 * - `$getAll(path, [])` collects every depth (depth first, pre-order), `$setAll(path, [], v)`
 *   writes every node; the expansions of a family are read-only.
 *
 * The engines with a `$recursion` get their `onPatternCreated`, `resolve`, `getAll` and `setAll`
 * wrapped; an engine without one pays nothing. The static checks of 3.3 (colliding families,
 * structural suffixes on getters) are the diagnostics add-on's (approved simplification).
 */
import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { StateRow } from "../list";
import { raiseError } from "../parser/raiseError";
import { recursionUnsupported } from "../parser/parseStatePart";

const NAME = "$recursion";
const MAX_DEPTH = 128;

interface Spec {
  /** `nodes` (the anchor without its trailing `.*`). */
  readonly list: string;
  /** `.children.*` */
  readonly step: string;
  /** `children` */
  readonly key: string;
  /** Families by suffix (`.total`): the author's getter. */
  readonly families: Map<string, (this: unknown) => unknown>;
  readonly matchers: [RegExp, string][];
  /** Node list patterns: `nodes`, `nodes.*.children`, `nodes.*.children.*.children`, … */
  readonly nodeList: RegExp;
  /** The family key each materialized expansion belongs to. */
  readonly owners: Map<Pattern, string>;
}

const specs = new WeakMap<Engine, Spec>();
const wrapped = new WeakSet<Engine>();
/** Patterns created while the state's accessors are registered (the `**` keys among them are templates). */
const registering = new WeakSet<Engine>();
let engines = 0;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const code = (c: string) => `[wcs/recursion-${c}]`;

function checkPath(kind: string, path: unknown): string {
  const bad = (why: string): never => raiseError(`${code("declaration-invalid")} ${NAME} ${kind} "${String(path)}" ${why}`);
  if (typeof path !== "string" || path === "") raiseError(`${code("declaration-invalid")} ${NAME} ${kind} must be a non-empty string.`);
  const segs = path.split(".");
  if (segs.length < 2 || segs[segs.length - 1] !== "*") bad('must end with ".*" (a list element).');
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (s === "") bad("must not contain empty path segments.");
    if (s === "*" || s === "**" || /^\d/.test(s)) bad('must have exactly one "*", at the end.');
    if (s.includes("#")) bad('must not contain "#".');
  }
  if (path[0] === "$") bad('must not start with "$".');
  return path;
}

/** Reads and checks the declaration; null when the state has none. */
function read(target: Record<string, any>): Spec | null {
  const decl = target[NAME];
  const keys: [string, PropertyDescriptor][] = [];
  const seen = new Set<string>();
  for (let o: object | null = target; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) {
      if (!seen.has(k) && k.includes("**")) keys.push([k, Object.getOwnPropertyDescriptor(o, k)!]);
      seen.add(k);
    }
  }
  if (decl === undefined) {
    if (keys.length > 0) recursionUnsupported(keys[0][0]);
    return null;
  }
  if (decl === null || typeof decl !== "object" || Array.isArray(decl)) {
    raiseError(`${code("declaration-invalid")} ${NAME} must be an object mapping one anchor path to its repeating sub-path.`);
  }
  const entries = Object.entries(decl);
  if (entries.length !== 1) raiseError(`${code("declaration-invalid")} ${NAME} must declare exactly one anchor (it declares ${entries.length}).`);
  const anchor = checkPath("anchor", entries[0][0]);
  const repeat = checkPath("repeat", entries[0][1]);
  const list = anchor.slice(0, -2);
  const key = repeat.slice(0, -2);
  const step = `.${repeat}`;
  const families = new Map<string, (this: unknown) => unknown>();
  const matchers: [RegExp, string][] = [];
  const head = `${list}.**`;
  for (const [k, d] of keys) {
    const suffix = k.slice(head.length);
    if (!k.startsWith(head) || (suffix !== "" && suffix[0] !== ".") || suffix.includes("**")) {
      raiseError(`[wcs/recursion-anchor] "${k}": a recursive key is "${head}" followed by a path (the anchor is "${anchor}").`);
    }
    if (suffix === "" || suffix.split(".").slice(1).some((s) => s === "")) raiseError(`[wcs/recursion-anchor] "${k}" needs a path after "**".`);
    if (d.get === undefined || d.set !== undefined) raiseError(`${code("declaration-invalid")} "${k}": a recursive key is a getter without a setter.`);
    families.set(suffix, d.get);
    matchers.push([new RegExp(`^${esc(anchor)}((?:${esc(step)})*)${esc(suffix)}$`), suffix]);
  }
  return { list, step, key, families, matchers, owners: new Map(), nodeList: new RegExp(`^${esc(list)}((?:${esc(`.*.${key}`)})*)$`) };
}

/** `nodes.*` + `.children.*` × k */
const nodePath = (spec: Spec, k: number): string => `${spec.list}.*${spec.step.repeat(k)}`;

/** The depth of the node row `row` is in or under (null: not under the anchor). */
function depthOf(spec: Spec, row: StateRow | null): { k: number; row: StateRow } | null {
  for (let r = row; r !== null; r = r.list.parentRow) {
    const m = spec.nodeList.exec(r.list.pattern.path);
    if (m !== null) return { k: m[1].length / (spec.key.length + 3), row: r };
  }
  return null;
}

/** What follows `nodes.**` in a path (`.x`, or "" for the nodes themselves). */
function suffixOf(spec: Spec, path: string): string {
  const head = `${spec.list}.**`;
  const rest = path.slice(head.length);
  if (!path.startsWith(head) || (rest !== "" && rest[0] !== ".") || rest.includes("**")) {
    raiseError(`[wcs/recursion-anchor] "${path}" does not start at the recursion anchor "${spec.list}.*".`);
  }
  return rest;
}

/** `nodes.**.x` → the concrete depth of the evaluation's row. */
function bind(spec: Spec, path: string, ctx: StateRow | null): string {
  const rest = suffixOf(spec, path);
  const at = depthOf(spec, ctx);
  if (at === null) {
    raiseError(`[wcs/recursion-context] "${path}" uses "**", which is bound to the depth of the row it is evaluated in; there is none here — use $getAll("${path}", []) for every depth.`);
  }
  return nodePath(spec, at.k) + rest;
}

/** Every node row, depth first and pre-order: (depth, row). Reads (and so tracks) each list. */
function walk(engine: Engine, spec: Spec, visit: (k: number, row: StateRow) => void): void {
  const ancestors = new Set<unknown>();
  const seen = new Set<unknown>();
  const enter = (arr: unknown, listPath: string, k: number): boolean => {
    if (!Array.isArray(arr) || arr.length === 0) return false;
    if (ancestors.has(arr)) raiseError(`${code("cycle")} "${listPath}" is reachable from itself: the data under "${spec.list}" must be a tree.`);
    if (seen.has(arr)) raiseError(`${code("shared-list")} "${listPath}" is the same array instance as a list reached before: the data under "${spec.list}" must be a tree.`);
    if (k + 1 > MAX_DEPTH) raiseError(`${code("depth-exceeded")} Recursion on "${spec.list}.*" reached depth ${k + 1} (the limit is ${MAX_DEPTH}).`);
    seen.add(arr);
    return true;
  };
  const down = (rows: StateRow[], k: number): void => {
    for (const row of rows) {
      visit(k, row);
      const listP = engine.pattern(`${nodePath(spec, k)}.${spec.key}`);
      const arr = engine.read(listP, row);
      if (!enter(arr, listP.path, k + 1)) continue;
      ancestors.add(arr);
      down(engine.childList(row, listP).rows, k + 1);
      ancestors.delete(arr);
    }
  };
  const rootP = engine.pattern(spec.list);
  const arr = engine.read(rootP, null);
  if (!enter(arr, spec.list, 0)) return;
  ancestors.add(arr);
  down(engine.rootList(rootP).rows, 0);
}

function wrap(engine: Engine): void {
  wrapped.add(engine);
  const e = engine as any;
  const created = e.onPatternCreated;
  e.onPatternCreated = (p: Pattern) => {
    const spec = specs.get(engine);
    if (spec !== undefined && p.path.includes("**")) {
      // a recursive key's own pattern while the accessors are registered: an inert template
      if (!registering.has(engine)) created.call(engine, p);
      else if (p.getter !== null) p.getter = () => recursionUnsupported(p.path);
      return;
    }
    if (spec !== undefined && p.getter === null) {
      for (const [re, suffix] of spec.matchers) {
        if (!re.test(p.path)) continue;
        p.getter = spec.families.get(suffix)!;
        if (p.depth > 0) p.slot = e.slotCount++;
        spec.owners.set(p, spec.list + ".**" + suffix);
        break;
      }
    }
    created.call(engine, p);
  };
  const resolve = e.resolve;
  e.resolve = (path: string, ctx: StateRow | null) => {
    const spec = specs.get(engine);
    return resolve.call(engine, spec !== undefined && path.includes("**") ? bind(spec, path, ctx) : path, ctx);
  };
  const getAll = e.getAll;
  e.getAll = (path: string, indexes?: number[]) => {
    const spec = specs.get(engine);
    if (spec === undefined || !path.includes("**")) return getAll.call(engine, path, indexes);
    if (indexes === undefined) return getAll.call(engine, bind(spec, path, e.ctx));
    if (!Array.isArray(indexes) || indexes.length > 0) {
      raiseError(`${code("getall-form")} $getAll("${path}", indexes) with "**" takes either no indexes (this depth) or [] (every depth).`);
    }
    const suffix = suffixOf(spec, path);
    const out: unknown[] = [];
    walk(engine, spec, (k, row) => {
      for (const v of getAll.call(engine, nodePath(spec, k) + suffix, engine.indexesOf(row))) out.push(v);
    });
    return out;
  };
  const setAll = e.setAll;
  e.setAll = (path: string, indexes: number[], value: unknown, options?: { spread?: boolean }) => {
    const spec = specs.get(engine);
    if (spec === undefined || !path.includes("**")) return setAll.call(engine, path, indexes, value, options);
    if (!Array.isArray(indexes)) throw new Error(`$setAll("${path}") needs indexes ([] for every match)`);
    if (indexes.length > 0) raiseError(`${code("setall-form")} $setAll("${path}", indexes, …) with "**" takes no partial prefix: pass [] to write every node.`);
    if (typeof value === "function" || options?.spread === true) throw new Error(`$setAll("${path}", [], value) with "**" takes a plain value (no mapper, no spread).`);
    if (e.readonlyDepth > 0) throw new Error("This state is readonly.");
    const suffix = suffixOf(spec, path);
    if (suffix === `.${spec.key}` || suffix.startsWith(`.${spec.key}.`)) {
      raiseError(`${code("structural-write")} "${path}" writes the recursion structure itself (the "${spec.key}" lists).`);
    }
    for (const s of spec.families.keys()) {
      if (suffix === s || suffix.startsWith(`${s}.`)) raiseError(`${code("readonly")} "${path}" writes into the recursive getter "${spec.list}.**${s}".`);
    }
    // every node first: a tree that fails the walk writes nothing
    const nodes: [number, StateRow][] = [];
    walk(engine, spec, (k, row) => nodes.push([k, row]));
    let written = 0;
    for (const [k, row] of nodes) written += setAll.call(engine, nodePath(spec, k) + suffix, engine.indexesOf(row), value);
    return written;
  };
}

/** The `declare` hook: a state received (construction, or a re-set before it replaces the old one). */
export function declareRecursion(engine: Engine, target: Record<string, any>): void {
  const spec = read(target);
  const had = specs.has(engine);
  if (spec === null) {
    if (had) {
      specs.delete(engine);
      engines--;
    }
    return;
  }
  if (!had) engines++;
  specs.set(engine, spec);
  registering.add(engine);
  if (!wrapped.has(engine)) wrap(engine);
}

/** The `element` hook: the state's accessors are registered — a new `**` pattern is refused again. */
export function recursionSettled(engine: Engine): void {
  registering.delete(engine);
}

/** The `beforeWrite` hook: an expansion of a recursive getter is read-only. */
export function guardExpansion(engine: Engine, p: Pattern): boolean {
  if (engines === 0) return false;
  const spec = specs.get(engine);
  if (spec === undefined) return false;
  for (let q: Pattern | null = p; q !== null; q = q.parent) {
    const owner = spec.owners.get(q);
    if (owner !== undefined) raiseError(`${code("readonly")} "${p.path}" writes into the recursive getter "${owner}".`);
  }
  return false;
}
