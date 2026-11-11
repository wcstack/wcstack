/**
 * scriptWriteValidator.ts
 *
 * What a state's getters, setters and methods write, as one set per callable (docs/script-write-checks.md). The AST
 * (scriptAst.ts) collects each body's writes — an assignment, a compound assignment, `++` / `--`, `$setAll`, `$update`,
 * a `$resolve` with a value — its reads and the methods it calls through `this`; this joins them across the state:
 *
 * - `wcs/getter-write` (error): a getter that writes while it is evaluated, itself or in a method it calls. The runtime
 *   throws on every evaluation (since 4.17 naming the path and the getter). A write in a nested function is not
 *   counted: it may run after the evaluation (a handler the getter returns).
 * - `wcs/path-readonly` (error, the code a two-way binding gets for the same path): a script writes a getter without a
 *   setter — `this.total = 0`, `$setAll("items.*.subtotal", …)`. The runtime throws each time the write runs. Read only
 *   where the state's declarations are all readable (no top-level spread: it may bring the setter).
 * - `wcs/setter-cycle`: a setter that writes its own path (error), or setters that write each other (warning — a
 *   condition may stop them). A setter's path is the accessor itself: writing it calls the setter again, until the
 *   stack overflows (since 4.17 the diagnostics add-on names the setters at 64 calls deep). Synchronous writes only.
 * - `wcs/setter-unobserved` (warning): a setter none of whose writes its getter reads — through the getters and the
 *   methods it calls, and inside `$untracked`. After the write the getter returns its old value, and a two-way input
 *   bound to it goes back to it, without a word. A setter that writes nothing (it ignores the value — the storage
 *   README's accessor pair ignores `null`) and a getter that reads nothing of the state are not reported, and nothing
 *   is said where either side reads or writes what cannot be followed: `this[key]`, `this` handed to a function, a
 *   path that is not a literal, a method the state does not declare.
 *
 * Paths match when one is the other or under it, a numeric segment or a `*` matching any (a write of `user.name`
 * reaches a getter that reads `user`). The callables are the `export default { … }` literal's top-level getters,
 * setters and methods (analyzeCallableBodies); `$watch` handlers and class-syntax states are not read.
 */

import { parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';
import { accessorRow, analyzeCallableBodies, hasDefaultExportObject, type CallableBody } from './stateAnalyzer.js';
import { isReadableStateScript } from './statePathResolver.js';
import { collectGetterReads, type GetterRead } from './scriptAst.js';
import { toWildcardForm } from './indexPath.js';
import { hasRecursionWildcard } from './recursionPaths.js';

/** A path read, written or called in a body (offsets relative to the script). */
interface Use {
  readonly path: string;
  readonly start: number;
  readonly end: number;
  /** In a function nested in the body: it may not run while the body runs. */
  readonly nested: boolean;
  /** A write of the state's path itself, not into an object under it (`this.user.name = x`). */
  readonly state?: boolean;
}

/** One callable's uses. */
interface Body {
  readonly callable: CallableBody;
  readonly writes: readonly Use[];
  readonly reads: readonly Use[];
  /** `this.<name>()` — the name of what it calls. */
  readonly calls: readonly Use[];
  /** Something it reads or writes cannot be followed (or the body does not parse). */
  readonly opaque: boolean;
}

const OPTIONS = { writes: true, templates: true, resolveWrites: true, untracked: true, opaque: true } as const;

function isWrite(read: GetterRead): boolean {
  return read.form === 'write' || read.form === 'api-write' || (read.written && read.form !== 'opaque');
}

function bodyOf(callable: CallableBody): Body {
  const found = collectGetterReads(callable.body, { ...OPTIONS, row: accessorRow(callable) });
  if (found === null) return { callable, writes: [], reads: [], calls: [], opaque: true };
  const writes: Use[] = [];
  const reads: Use[] = [];
  const calls: Use[] = [];
  let opaque = false;
  for (const read of found) {
    const at = { start: callable.bodyStart + read.start, end: callable.bodyStart + read.end, nested: read.nested === true };
    // (a path relative to the row with no row known — in a method, whose row is the caller's: it cannot be followed)
    if (read.form === 'opaque' || read.path.startsWith('.')) {
      opaque = true;
      continue;
    }
    if (isWrite(read)) {
      // the state's own path (`this.a`, `this["a.b"]`, the API's path), or into an object under a path (`this.user.name`)
      const state = read.form === 'api-write' || (read.chain !== null && read.chain.length === 1);
      writes.push({ path: read.form === 'api-write' ? read.path : read.chain?.join('.') ?? read.path, state, ...at });
      // a compound assignment reads first
      if (read.form === 'member') reads.push({ path: read.path, ...at });
      continue;
    }
    if (read.callee && read.chain !== null && read.chain.length === 1) calls.push({ path: read.chain[0], ...at });
    reads.push({ path: read.path, ...at });
  }
  return { callable, writes, reads, calls, opaque };
}

/** `a` is `b`, or one is under the other — a numeric segment or a `*` matching any segment. */
function overlaps(a: string, b: string): boolean {
  const x = toWildcardForm(a).split('.');
  const y = toWildcardForm(b).split('.');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i] && x[i] !== '*' && y[i] !== '*') return false;
  }
  return true;
}

/** A state's callables, by kind. */
interface StateBodies {
  readonly getters: ReadonlyMap<string, Body>;
  readonly setters: ReadonlyMap<string, Body>;
  readonly methods: ReadonlyMap<string, Body>;
}

/** The state writes a body makes while it runs: its own outside nested functions, and those of the methods it calls there. */
function syncWrites(body: Body, state: StateBodies, seen: Set<Body> = new Set()): Use[] {
  if (seen.has(body)) return [];
  seen.add(body);
  const out = body.writes.filter((w) => w.state === true && !w.nested);
  for (const call of body.calls) {
    const method = state.methods.get(call.path);
    if (!call.nested && method !== undefined) out.push(...syncWrites(method, state, seen));
  }
  return out;
}

/** Every path a body may write, through the methods it calls and the setters it writes; null when that cannot be followed. */
function allWrites(body: Body, state: StateBodies, seen: Set<Body> = new Set()): Set<string> | null {
  const out = new Set<string>();
  if (seen.has(body)) return out;
  seen.add(body);
  if (body.opaque) return null;
  for (const w of body.writes) {
    out.add(w.path);
    // a write of a setter's path is what that setter writes, too (as the runtime counts it)
    const setter = state.setters.get(toWildcardForm(w.path));
    if (setter === undefined) continue;
    const more = allWrites(setter, state, seen);
    if (more === null) return null;
    for (const p of more) out.add(p);
  }
  for (const call of body.calls) {
    const method = state.methods.get(call.path);
    if (method === undefined) return null;
    const more = allWrites(method, state, seen);
    if (more === null) return null;
    for (const p of more) out.add(p);
  }
  return out;
}

/** Every path a body may read, through the getters it reads and the methods it calls; null when that cannot be followed. */
function allReads(body: Body, state: StateBodies, seen: Set<Body> = new Set()): Set<string> | null {
  const out = new Set<string>();
  if (seen.has(body)) return out;
  seen.add(body);
  if (body.opaque) return null;
  for (const r of body.reads) {
    out.add(r.path);
    const getter = state.getters.get(r.path);
    if (getter !== undefined) {
      const more = allReads(getter, state, seen);
      if (more === null) return null;
      for (const p of more) out.add(p);
    }
  }
  for (const call of body.calls) {
    const method = state.methods.get(call.path);
    if (method === undefined) return null;
    const more = allReads(method, state, seen);
    if (more === null) return null;
    for (const p of more) out.add(p);
  }
  return out;
}

export function validateScriptWrites(html: string, stateTagName: string = 'wcs-state', locale?: string): WcsDiagnostic[] {
  const blocks = parseLoadedScriptBlocks(html, stateTagName).filter((block) => hasDefaultExportObject(block.content));
  if (blocks.length === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const block of blocks) {
    const getters = new Map<string, Body>();
    const setters = new Map<string, Body>();
    const methods = new Map<string, Body>();
    for (const callable of analyzeCallableBodies(block.content)) {
      const body = bodyOf(callable);
      if (callable.kind === 'method') methods.set(callable.name, body);
      else (callable.accessor === 'set' ? setters : getters).set(callable.name, body);
    }
    const state: StateBodies = { getters, setters, methods };
    const at = (start: number, end: number) => ({ start: block.contentStart + start, end: block.contentStart + end });
    out.push(...getterWrites(state, msgs, at));
    if (isReadableStateScript(block.content)) out.push(...readonlyWrites(state, msgs, at));
    out.push(...setterCycles(state, msgs, at));
    out.push(...unobservedSetters(state, msgs, at));
  }
  return out;
}

type At = (start: number, end: number) => { start: number; end: number };

/** `wcs/getter-write`: a getter's own writes, and the calls of methods that write. */
function getterWrites(state: StateBodies, msgs: WcsMessageCatalog, at: At): WcsDiagnostic[] {
  const out: WcsDiagnostic[] = [];
  for (const [name, getter] of state.getters) {
    // (an accessor declared for several paths: its one body is reported at the first of them)
    const listed = getter.callable.listed;
    if (listed !== undefined && listed.paths[0] !== name) continue;
    for (const w of getter.writes) {
      if (w.state !== true || w.nested) continue;
      out.push({ code: WcsDiagnosticCode.GetterWrite, ...at(w.start, w.end), message: msgs.getterWrite(w.path, name), severity: 'error' });
    }
    for (const call of getter.calls) {
      const method = state.methods.get(call.path);
      if (call.nested || method === undefined) continue;
      const writes = syncWrites(method, state);
      if (writes.length === 0) continue;
      out.push({ code: WcsDiagnosticCode.GetterWrite, ...at(call.start, call.end), message: msgs.getterWrite(writes[0].path, name, call.path), severity: 'error' });
    }
  }
  return out;
}

/** `wcs/path-readonly`: a write of a getter without a setter, from a method or a setter (a getter's is `wcs/getter-write`). */
function readonlyWrites(state: StateBodies, msgs: WcsMessageCatalog, at: At): WcsDiagnostic[] {
  const readonly = new Set([...state.getters.keys()].filter((name) => !state.setters.has(name)));
  if (readonly.size === 0) return [];
  const out: WcsDiagnostic[] = [];
  for (const body of [...state.methods.values(), ...state.setters.values()]) {
    // (an accessor declared for several paths: a write by a full path is the same at each of them)
    const listed = body.callable.listed;
    const again = listed !== undefined && listed.paths[0] !== body.callable.name;
    for (const w of body.writes) {
      const path = toWildcardForm(w.path);
      if (w.state !== true || hasRecursionWildcard(path) || !readonly.has(path)) continue;
      if (again && out.some((d) => d.start === at(w.start, w.end).start)) continue;
      out.push({ code: WcsDiagnosticCode.PathReadonly, ...at(w.start, w.end), message: msgs.pathReadonlyWrite(path), severity: 'error' });
    }
  }
  return out;
}

/** `wcs/setter-cycle`: the setters each setter's synchronous writes call (a DFS as `wcs/getter-cycle`'s). */
function setterCycles(state: StateBodies, msgs: WcsMessageCatalog, at: At): WcsDiagnostic[] {
  const out: WcsDiagnostic[] = [];
  const edges = new Map<string, string[]>();
  for (const [name, setter] of state.setters) {
    const targets = new Set(syncWrites(setter, state).map((w) => toWildcardForm(w.path)).filter((p) => state.setters.has(p)));
    if (targets.has(name)) {
      out.push({ code: WcsDiagnosticCode.SetterCycle, ...at(setter.callable.start, setter.callable.end), message: msgs.setterCycleSelf(name), severity: 'error' });
      targets.delete(name);
    }
    edges.set(name, [...targets]);
  }
  const gray = new Set<string>();
  const black = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, string>();
  const visit = (name: string): void => {
    if (black.has(name)) return;
    if (gray.has(name)) {
      const from = stack.indexOf(name);
      const cycle = [...stack.slice(from), name].map((p) => `"${p}"`).join(' -> ');
      for (const member of stack.slice(from)) if (!cycles.has(member)) cycles.set(member, cycle);
      return;
    }
    gray.add(name);
    stack.push(name);
    for (const next of edges.get(name) ?? []) visit(next);
    stack.pop();
    gray.delete(name);
    black.add(name);
  };
  for (const name of state.setters.keys()) visit(name);
  for (const [name, cycle] of cycles) {
    const setter = state.setters.get(name)!;
    out.push({ code: WcsDiagnosticCode.SetterCycle, ...at(setter.callable.start, setter.callable.end), message: msgs.setterCycle(cycle), severity: 'warning' });
  }
  return out;
}

/** `wcs/setter-unobserved`: a setter whose writes its getter does not read. */
function unobservedSetters(state: StateBodies, msgs: WcsMessageCatalog, at: At): WcsDiagnostic[] {
  const out: WcsDiagnostic[] = [];
  for (const [name, setter] of state.setters) {
    const getter = state.getters.get(name);
    if (getter === undefined) continue;
    const writes = allWrites(setter, state);
    // (a setter that writes its own path is wcs/setter-cycle's)
    if (writes === null || writes.size === 0 || [...writes].some((w) => toWildcardForm(w) === name)) continue;
    const reads = allReads(getter, state);
    if (reads === null || reads.size === 0) continue;
    if ([...writes].some((w) => [...reads].some((r) => overlaps(w, r)))) continue;
    const listed = [...writes].map((w) => `"${w}"`).join(', ');
    out.push({ code: WcsDiagnosticCode.SetterUnobserved, ...at(setter.callable.start, setter.callable.end), message: msgs.setterUnobserved(name, listed), severity: 'warning' });
  }
  return out;
}
