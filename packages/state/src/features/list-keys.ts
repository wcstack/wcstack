/**
 * The list-keys add-on (@wcstack/state/features/list-keys): `$listKeys` — identity for refetched
 * rows (README "$listKeys"). Assigning an array to a declared list path keeps the row objects whose
 * key matches and writes into them only the fields that changed (a dropped field is cleared with
 * null); the stored array is rebuilt from the kept objects, so rows, their DOM and focus survive a
 * refresh, and a refresh that changes nothing does nothing.
 */
import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { StateRow } from "../list";
import { chain, first, handled, hooks, type Feature } from "../hooks";
import { raiseError } from "../parser/raiseError";

type KeyOf = (row: Record<string, unknown>) => unknown;

/** By state object: a re-set refused after the declaration (recursion) leaves the old state's keys in force. */
const keysByTarget = new WeakMap<object, Map<Pattern, KeyOf>>();
/** The merged array is being written: the write goes through as a plain one. */
let merging = false;
const PROTO = "__proto__";
/** A field name that is one path segment (no `.` / `*`, not an index, not a `$` name, not `prototype`: a path refuses it). */
const SEGMENT = /^(?!prototype$)[^\d.*$][^.*]*$/;

function declare(engine: Engine, target: Record<string, any>): void {
  const decl = target.$listKeys;
  const keys = new Map<Pattern, KeyOf>();
  if (decl !== undefined) {
    if (decl === null || typeof decl !== "object") raiseError("$listKeys must be an object mapping list paths to a key field or function.");
    for (const path of Object.keys(decl)) {
      const key = decl[path];
      if (typeof key === "string") keys.set(engine.pattern(path), (row) => row[key]);
      else if (typeof key === "function") keys.set(engine.pattern(path), key as KeyOf);
      else raiseError(`$listKeys "${path}" must be a field name or a function.`);
    }
  }
  keysByTarget.set(target, keys);
}

function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function keyed(path: string, rows: readonly unknown[], keyOf: KeyOf): Map<unknown, Record<string, unknown>> {
  const out = new Map<unknown, Record<string, unknown>>();
  for (const r of rows) {
    if (!isPlain(r)) raiseError(`$listKeys "${path}": rows must be plain objects.`);
    const k = keyOf(r);
    if (k === undefined || k === null) raiseError(`$listKeys "${path}": a row has no key.`);
    if (out.has(k)) raiseError(`$listKeys "${path}": duplicate key ${JSON.stringify(k)}.`);
    out.set(k, r);
  }
  return out;
}

function beforeWrite(engine: Engine, p: Pattern, row: StateRow | null, value: unknown): boolean {
  if (merging || !Array.isArray(value)) return false;
  const keyOf = keysByTarget.get(engine.target)?.get(p);
  if (keyOf === undefined) return false;
  const old = engine.readData(p, row);
  if (!Array.isArray(old) || old === value) return false;
  const before = keyed(p.path, old, keyOf);
  keyed(p.path, value, keyOf);
  // the stored array: the kept objects where keys match, the new ones elsewhere
  const merged: unknown[] = [];
  const updates: [number, Record<string, unknown>, Record<string, unknown>][] = [];
  let same = old.length === value.length;
  for (let i = 0; i < value.length; i++) {
    const next = value[i] as Record<string, unknown>;
    const kept = before.get(keyOf(next));
    merged.push(kept ?? next);
    if (kept !== undefined) updates.push([i, kept, next]);
    if (merged[i] !== old[i]) same = false;
  }
  const changes: [number, string, unknown][] = [];
  for (const [i, kept, next] of updates) {
    for (const f of Object.keys(next)) if (!Object.is(kept[f], next[f])) changes.push([i, f, next[f]]);
    for (const f of Object.keys(kept)) if (!(f in next) && kept[f] !== null) changes.push([i, f, null]);
  }
  if (same && changes.length === 0) return true; // a no-op refresh does nothing
  if (!same) {
    merging = true;
    try {
      engine.write(p, row, merged);
    } finally {
      merging = false;
    }
  }
  if (changes.length > 0) {
    const list = engine.childList(p.depth === 0 ? null : row, p);
    for (const [i, f, v] of changes) {
      // a field name is the server's. `__proto__` (an own key from JSON) is not a field: copied, it
      // would replace the row's prototype. A name that is not one path segment (`@odata.etag`,
      // `2fa`) or is a row getter's goes into the row as it is, the row told as a whole.
      if (f === PROTO) continue;
      const r = list.rows[i];
      const fp = SEGMENT.test(f) ? engine.pattern(`${p.path}.*.${f}`) : null;
      if (fp?.getter === null) engine.write(fp, r, v);
      else {
        (r.item as Record<string, unknown>)[f] = v;
        engine.write(engine.pattern(`${p.path}.*`), r, r.item, true);
      }
    }
  }
  return true;
}

export const listKeys: Feature = {
  name: "list-keys",
  install(): void {
    hooks.declare = chain(hooks.declare, declare);
    hooks.beforeWrite = first(handled, hooks.beforeWrite, beforeWrite);
  },
};
export default listKeys;
