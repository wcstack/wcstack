/**
 * The diagnostics add-on (@wcstack/state/features/diagnostics): the sentences and the self-fix
 * guidance of error messages. The core states the message number and the values
 * (`#901 "$resolve" "m.*.*" 2 1`); with this installed, the message is the code shared with lint
 * and the sentence (`[wcs/index-arity] $resolve("m.*.*") takes 2 index(es), got 1.`), followed by the
 * nearest name (did-you-mean, the same rule as lint), how to fix it, and a pointer to lint where
 * lint really detects the case. The full `auto` bundle installs it.
 */
import { chain, first, handled, hooks, known, type Feature } from "../hooks";
import type { Engine } from "../engine";
import { parsePath, type Pattern } from "../pattern";
import { raiseError } from "../parser/raiseError";
import { parseBindTextsForElement } from "../parser/parseBindTextsForElement";
import { config } from "../config";
import type { WcsState } from "../element";
import { Binding, K_CUSTOM, type RowPlan } from "../dom/view";
import { walked } from "../dom/plan";
import type { StateList } from "../list";
import { getTrustedTypesPolicy, isHtmlSink } from "../trustedTypes";
import { didYouMean, LINT_HINT } from "../diagnostics/guidance";
import { explain, render } from "../diagnostics/explain";
import { was } from "../diagnostics/messages";
import { raise, M } from "../messages";
import type { Token } from "../token";

// ---------------------------------------------------------------- paths that do not resolve

/** What named a path: a binding, a `$watch` key, a `$postUpdate` call, a getter's read. */
const BINDING = 0;
const WATCH = 1;
const POST = 2;
const READ = 3;
/** Paths bindings, `$watch` keys and `$postUpdate` named, by engine: checked one macrotask later (and after a re-set). */
const named = new WeakMap<Engine, Map<Pattern, number>>();
const checked = new WeakMap<Engine, Set<Pattern>>();
const due = new WeakSet<Engine>();
/** Volumes (`<wcs-state mount>`) whose loading settled: the paths under them are checked from then on. */
const settled = new WeakSet<Element>();

function findDescriptor(o: object, key: string): PropertyDescriptor | undefined {
  for (let x: object | null = o; x !== null && x !== Object.prototype; x = Object.getPrototypeOf(x)) {
    const d = Object.getOwnPropertyDescriptor(x, key);
    if (d !== undefined) return d;
  }
  return undefined;
}

function keysOf(o: object): string[] {
  const out = new Set<string>();
  for (let x: object | null = o; x !== null && x !== Object.prototype; x = Object.getPrototypeOf(x)) {
    for (const k of Object.getOwnPropertyNames(x)) if (k[0] !== "$" && k !== "constructor") out.add(k);
  }
  return [...out];
}

/**
 * The pattern a path with an explicit index reads through: an index with no `*` after it
 * (`items.0.x`) has an accessor of its own (Engine.markupAccessor), so whether it reads a getter
 * is the question of the pattern it names (`items.*.x`). A `*` after the index (`groups.0.items.*.x`,
 * a row of `for: groups.0.items`) reads its row's own item: the pattern itself. So does a path the
 * author declared a getter under (`get "groups.0.items"()`): that getter is what it reads (#388).
 */
function wildcardForm(engine: Engine, q: Pattern): Pattern | undefined {
  const segs = q.path.split(".");
  // (a leading numeric segment is a root key, not an index: parsePath)
  const i = segs.findIndex((s, j) => j > 0 && /^\d/.test(s));
  return i < 0 || segs.indexOf("*", i) >= 0 || findDescriptor(engine.target, q.path)?.get !== undefined
    ? q : engine.patterns.peek(parsePath(q.path).pattern);
}

/** The list `under` last found with no row to look into (a path under it is checked again when it has rows). */
let emptyList: Pattern | null = null;
/** The lists whose rows the paths under them wait for, by engine. */
const awaitingRows = new WeakMap<Engine, Set<Pattern>>();

/**
 * The segment of `p` that certainly does not exist, with the names that do at its level; null
 * when the path exists or it cannot be told without evaluating a getter (a getter on the way, a
 * null or primitive on the way, a list with no row to look into — `emptyList` then names it).
 */
function missing(engine: Engine, p: Pattern): { seg: string; names: string[]; row: boolean } | null {
  const chain: Pattern[] = [];
  for (let q: Pattern | null = p; q !== null; q = q.parent) chain.unshift(q);
  const named = (q: Pattern | null): Pattern | null | undefined => (q === null ? null : wildcardForm(engine, q));
  // The rows of a list a getter returns are there to look into, as a data list's are: its value now, when it is
  // the first getter on the path, data alone leads to it and no getter is declared under it (`for: rows` over
  // `get rows()` and `.amountLabl` — docs/seam-apps.md, ledger-repair)
  const g = chain.findIndex((q) => named(q)?.getter != null);
  if (g >= 0 && chain[g + 1]?.last === "*" && !chain.some((q, k) => (k < g && q.last === "*") || (k > g && named(q)?.getter != null))) {
    let rows: unknown;
    try {
      rows = engine.readUntracked(named(chain[g])!, null);
    } catch {
      // (the getter's failure is its binding's, reported already)
      return null;
    }
    return under(engine, chain, g + 1, rows, named);
  }
  // a getter anywhere on the path answers it — also one declared deeper than a segment the data
  // lacks (\`get "box.label"()\` with no \`box\` key: it renders and updates — docs/seam-apps.md)
  if (chain.some((q) => named(q)?.getter != null)) return null;
  return under(engine, chain, 0, engine.target, named);
}

/** `missing` from `chain[k]` on, in `v`. */
function under(engine: Engine, chain: Pattern[], k: number, v: any, named: (q: Pattern | null) => Pattern | null | undefined): { seg: string; names: string[]; row: boolean } | null {
  for (; k < chain.length; k++) {
    const q = chain[k];
    if (v === null || typeof v !== "object") return null;
    if (q.last === "*") {
      if (Array.isArray(v) && v.length === 0) emptyList = q.parent;
      if (!Array.isArray(v) || v.length === 0) return null;
      // a row field is declared when any row has it — an optional one (`pending` on the rows a page
      // added itself) is not missing because the first row lacks it (docs/seam-apps.md, ssr-news)
      // (missing in every row: the names any row has are the candidates)
      let first: { seg: string; names: string[]; row: boolean } | null = null;
      for (const row of v) {
        const m = under(engine, chain, k + 1, row, named);
        if (m === null) return null;
        if (first === null) first = m;
        else if (m.seg === first.seg) for (const n of m.names) if (!first.names.includes(n)) first.names.push(n);
      }
      return first;
    }
    if (Array.isArray(v) && /^\d+$/.test(q.last)) {
      // an explicit index: only a row that is there can be looked into
      if (Number(q.last) >= v.length) return null;
      v = v[Number(q.last)];
      continue;
    }
    const d = findDescriptor(v, q.last);
    // a top-level key a re-set dropped is declared: it reads undefined, and a write fills it
    if (d === undefined && q.parent === null && engine.dropped.has(q.last)) return null;
    if (d === undefined) {
      const names = keysOf(v);
      // getters declared one level under the same parent (`items.*.subtotal`)
      const parent = named(q.parent);
      for (const g of engine.patterns.all()) if (g.parent === parent && g.getter !== null) names.push(g.last);
      // an empty object under a key is a seed the page fills later (`fieldErrors: {}`, then
      // `this.fieldErrors = { date: "…" }`), as a `null` one is: nothing in it to be wrong about, and
      // the lint reads the assignments since 4.9 (docs/seam-apps.md, family-ledger)
      if (k > 0 && names.length === 0) return null;
      return { seg: q.last, names, row: chain.slice(0, k).some((x) => x.last === "*") };
    }
    if (d.get !== undefined || d.set !== undefined) return null;
    v = d.value;
  }
  return null;
}

function check(engine: Engine): void {
  due.delete(engine);
  const map = named.get(engine);
  if (map === undefined) return;
  let done = checked.get(engine);
  if (done === undefined) checked.set(engine, (done = new Set()));
  // The paths named, and those a getter read (`this["items.*.pirce"]`, `$getAll("items.*.pirce")`): such a read
  // gets undefined, and what is computed from it is wrong without a word (an outside evaluation, a tax return
  // draft). A top-level key the state lacks already fails the read (the core's error); a named path is reported
  // as named; the engine's own accessor of an index path (`items.0.x`) reads for the binding that named it
  const todo = new Map(map);
  const readers = new Map<Pattern, Pattern>();
  for (const p of engine.patterns.all()) {
    const g = p.parent === null || done.has(p) || map.has(p) ? undefined : p.dependents.find((d) => !d.markup);
    if (g === undefined) continue;
    readers.set(p, g);
    todo.set(p, READ);
  }
  for (const [p, kind] of todo) {
    if (done.has(p)) continue;
    done.add(p);
    emptyList = null;
    const m = missing(engine, p);
    if (m === null) {
      // a list with no row yet (a fetch on its way): checked again when it has rows (rowsArrived)
      if (emptyList !== null) {
        done.delete(p);
        let w = awaitingRows.get(engine);
        if (w === undefined) awaitingRows.set(engine, (w = new Set()));
        w.add(emptyList);
      }
      continue;
    }
    // under an object an element wrote (`searchParams: query` — the router's query has the URL's keys): its
    // shape is the element's, and a key it lacks now may come with the next write (docs/seam-apps.md, city-library)
    const wrote = byElement.get(engine);
    let up = p.parent;
    while (up !== null && !wrote?.has(up)) up = up.parent;
    if (up !== null) continue;
    // under the mount path of a volume on the page still loading: checked again once it settles (3.x D22)
    const v = [...((engine.root as ParentNode | null)?.querySelectorAll(`${config.tagNames.state}[mount]`) ?? [])]
      .find((e) => !settled.has(e) && (p.path + ".").startsWith(e.getAttribute("mount") + "."));
    if (v !== undefined) {
      done.delete(p);
      void (v as WcsState).initializePromise.then(() => {
        settled.add(v);
        schedule(engine);
      });
      continue;
    }
    // a row of `for: groups.0.items` with a row getter declared on `groups.*.items.*` (#388)
    const w = engine.patterns.peek(parsePath(p.path).pattern);
    let rowGetter = "";
    if (w !== undefined && w !== p && w.getter !== null) {
      const loops = w.lists.slice(1).map((l, k) => `for: ${k === 0 ? l!.path : l!.path.slice(w.lists[k]!.path.length + 2)}`);
      rowGetter = ` The getter "${w.path}" is declared for the rows of ${loops.join(" → ")}; a list named by an index has rows of its own.`;
    }
    const near = didYouMean(m.seg, m.names);
    // A row field no row has is not a sign of a mistake: rows are data, and an optional field (the
    // `pending` a page puts on its own rows) is absent from the server's (docs/seam-apps.md, ssr-news).
    // Reported only with a near name — a likely typo (`.nmae` beside `name`) — or a row getter of
    // another list form. So is a getter's read: `this["opts.flag"] ?? false` reads an optional key on purpose
    if ((m.row || kind === READ) && near === "" && rowGetter === "") continue;
    const [code, subject, source] = kind === WATCH ? ["watch-path-missing", "$watch path", "watch"]
      : kind === POST ? ["post-update-path-missing", "$postUpdate path", "postUpdate"]
      : kind === READ ? ["read-path-missing", "Path", "getter"]
      : ["binding-path-missing", "Bound path", "binding"];
    hooks.noticed?.(engine, { "type": "state:path-unresolved", "source": source, "path": p.path, "missingSegment": m.seg });
    console.warn(`[@wcstack/state] [wcs/${code}] ${subject} "${p.path}"${kind === READ ? ` read by the getter "${readers.get(p)!.path}"` : ""} does not resolve on the state tree: "${m.seg}" is not declared.${near}${rowGetter} ${kind === POST ? "The call updates nothing." : kind === READ ? "The getter reads undefined." : "Updates to this path will be silently dropped."}${LINT_HINT}`);
  }
}

/** A list a path waits on has rows now (listSynced): the paths under it are checked again. */
function rowsArrived(engine: Engine, l: StateList): void {
  if (l.rows.length > 0 && awaitingRows.get(engine)?.delete(l.pattern)) schedule(engine);
}

function schedule(engine: Engine): void {
  if (due.has(engine)) return;
  due.add(engine);
  setTimeout(() => check(engine), 0);
}

/** The `declared` hook: a path a binding or a `$watch` key names. */
function declared(engine: Engine, p: Pattern, watch = false): void {
  note(engine, p, watch ? WATCH : BINDING);
}

function note(engine: Engine, p: Pattern, kind: number): void {
  // a missing top-level key already fails the binding's read (the core's error)
  if (p.path[0] === "$" || p.path.includes("#") || (kind === BINDING && p.parent === null)) return;
  let map = named.get(engine);
  if (map === undefined) named.set(engine, (map = new Map()));
  if (!map.has(p)) map.set(p, kind);
  schedule(engine);
}

const wrapped = new WeakSet<Engine>();
/** A `$postUpdate` is running: what it lands is not a write (see written). */
let posting = false;

/**
 * `$postUpdate(path)` says what at a path changed in place; a path that does not resolve updates nothing,
 * and said nothing (`rows.${r}.cell.${c}.text` for `cells` — a 7GUIs evaluation's Cells). Its pattern is
 * checked as a binding's is, the top-level key too (no read fails for it).
 */
function watchPostUpdate(engine: Engine): void {
  if (wrapped.has(engine)) return;
  wrapped.add(engine);
  const api = (engine as any).api as Record<string, (path: string) => void>;
  const post = api.$postUpdate;
  api.$postUpdate = (path: string) => {
    posting = true;
    try {
      post(path);
    } finally {
      posting = false;
    }
    const p = engine.patterns.peek(parsePath(path).pattern);
    if (p !== undefined) note(engine, p, POST);
  };
}

/** The top-level keys a state declared (its own and its prototypes'), and those written since, by engine. */
const declaredKeys = new WeakMap<Engine, Set<string>>();

/** The paths an element wrote (an output binding): what is under them is the element's to shape. */
const byElement = new WeakMap<Engine, Set<Pattern>>();

function elementWrote(engine: Engine, p: Pattern, _row: unknown, _old: unknown, _value: unknown, _direct: boolean, element?: boolean): void {
  if (!element) return;
  let set = byElement.get(engine);
  if (set === undefined) byElement.set(engine, (set = new Set()));
  set.add(p);
}

/**
 * A write of a top-level key the state did not declare, beside a near one it did (`this.selectedID` and
 * `selectedId`): 4.0 creates the key, and nothing bound to the declared one changes (a 7GUIs evaluation's
 * CRUD). Warned once per key; a key with no near name is one the state adds on purpose.
 */
function written(engine: Engine, p: Pattern): void {
  const keys = declaredKeys.get(engine);
  const key = p.last;
  if (p.parent !== null || posting || keys === undefined || keys.has(key) || key[0] === "$" || engine.dropped.has(key)) return;
  const near = didYouMean(key, [...keys]);
  keys.add(key);
  // (a volume grafts its state at its mount path, and the keys on the way to it: those keys are the page's)
  if (near !== "" && ![...((engine.root as ParentNode | undefined)?.querySelectorAll(`${config.tagNames.state}[mount]`) ?? [])]
    .some((e) => `${e.getAttribute("mount")}.`.startsWith(`${key}.`))) {
    console.warn(`[@wcstack/state] [wcs/write-path-missing] "${key}" is not declared: writing it creates a new key.${near}${LINT_HINT}`);
  }
}

// ---------------------------------------------------------------- setters (docs/script-write-checks.md)

/** A setter being called, and the paths written while it runs (its own and the setters it calls). */
interface SetterCall {
  readonly p: Pattern;
  readonly writes: Pattern[];
}

/** The setters being called, innermost last: a write calls a setter synchronously, which may write. */
const calls: SetterCall[] = [];
/** Setters that call setters this deep write each other without end (the core has no guard: the stack overflows). */
const MAX_SETTER_DEPTH = 64;
/** The setters `[wcs/setter-unobserved]` was said for, by engine (once per path). */
const unobserved = new WeakMap<Engine, Set<string>>();

/**
 * The `beforeWrite` hook (it handles nothing): a write about to call an author's setter. A setter that writes its
 * own path calls itself, and two setters that write each other call each other, until the stack overflows with a
 * RangeError that names nothing; this names the setters at a depth no page reaches on purpose.
 */
function beforeSetter(_engine: Engine, p: Pattern): boolean {
  if (p.setter === null || p.markup) return false;
  if (calls.length >= MAX_SETTER_DEPTH) {
    const paths = calls.map((c) => c.p.path);
    const from = paths.lastIndexOf(p.path);
    calls.length = 0;
    raiseError(`[wcs/setter-cycle] setters write each other without end: ${[...paths.slice(Math.max(from, 0)), p.path].map((s) => `"${s}"`).join(" -> ")}. Writing a setter's own path calls it again: store the value under a data path the getter reads.`);
  }
  calls.push({ p, writes: [] });
  return false;
}

/** The paths getter `g` reads, and the paths the getters among them read, on down. */
function readClosure(g: Pattern): Set<Pattern> {
  const out = new Set<Pattern>();
  const add = (q: Pattern): void => {
    for (const s of q.sources) {
      if (out.has(s)) continue;
      out.add(s);
      if (s.getter !== null) add(s);
    }
  };
  add(g);
  return out;
}

/**
 * The `written` hook: a write while setters run belongs to each of them, and a setter's own landing ends its call:
 * the core hears of it when the setter returns or throws, the one landing with `direct` false that passes `element`
 * (Engine.write — `$postUpdate` of the same path, inside the setter, passes none). A setter that wrote something
 * (one that wrote nothing ignored the value on purpose — the storage README's accessor pair ignores `null`), none
 * of it what its getter reads, leaves the getter on its old value: a two-way input reverts to it on the next
 * render, without a word. Warned once per setter, and only once the getter has read something.
 */
function setterWrote(engine: Engine, p: Pattern, _row: unknown, _old: unknown, _value: unknown, direct: boolean, element?: boolean): void {
  if (calls.length === 0) return;
  if (!direct && element !== undefined) {
    let i = calls.length - 1;
    // (a pattern is one engine's: the same pattern is the same setter)
    while (i >= 0 && calls[i].p !== p) i--;
    if (i >= 0) {
      // (calls above it are writes another add-on took before the setter ran: they never return)
      const call = calls[i];
      calls.length = i;
      const g = call.p;
      if (g.getter !== null && g.sources.length > 0 && call.writes.length > 0) {
        const reads = [...readClosure(g)];
        if (!call.writes.some((q) => reads.some((s) => q.isUnder(s) || s.isUnder(q)))) {
          let said = unobserved.get(engine);
          if (said === undefined) unobserved.set(engine, (said = new Set()));
          if (!said.has(g.path)) {
            said.add(g.path);
            const wrote = [...new Set(call.writes.map((q) => `"${q.path}"`))].join(", ");
            console.warn(`[@wcstack/state] [wcs/setter-unobserved] the setter of "${g.path}" wrote ${wrote}, which its getter does not read: "${g.path}" keeps its value, and a two-way input goes back to it. Write what the getter reads.${LINT_HINT}`);
          }
        }
      }
    }
  }
  for (const c of calls) c.writes.push(p);
}

/** A drain: no setter runs across one (what a write left on the stack is another add-on's). */
function setterDrained(): void {
  calls.length = 0;
}

// ---------------------------------------------------------------- commands that reach nothing

/**
 * A command token emitted while nothing subscribes to it: the call is lost, and tokens keep nothing to replay.
 * Its `command.` binding may not be attached yet — the element is defined later (an autoloader, a slow CDN),
 * or it is in an `if:` branch the same update renders (emit from `$renderedCallback`) — or there is none.
 * Warned once per token (the author's decision, docs/v4-direction-2026-10.md §5.2 — a 7GUIs evaluation's Timer
 * and Cells). The engine's `commands` is watched from its first declaration on, so the tokens of a re-set
 * are wrapped too.
 */
function watchCommands(engine: Engine): void {
  if (Object.getOwnPropertyDescriptor(engine, "commands")?.set !== undefined) return;
  let ns = engine.commands;
  Object.defineProperty(engine, "commands", {
    configurable: true,
    get: () => ns,
    set: (v: Readonly<Record<string, Token>>) => {
      ns = v;
      for (const t of Object.values(v)) loud(t);
    },
  });
}

const wrappedTokens = new WeakSet<Token>();

function loud(t: Token): void {
  if (wrappedTokens.has(t)) return;
  wrappedTokens.add(t);
  const emit = t.emit;
  let said = false;
  (t as any).emit = (...args: unknown[]): unknown[] => {
    if (t.size === 0 && !said) {
      said = true;
      console.warn(`[@wcstack/state] [wcs/command-token-unbound] "$command.${t.name}" was emitted with no subscriber and is lost: its element is not defined or rendered yet (emit from $renderedCallback), or no command. binding takes it.${LINT_HINT}`);
    }
    return emit.apply(t, args);
  };
}

/** The handlers whose failure was explained, by engine. */
const explained = new WeakMap<Engine, Set<string>>();

/**
 * The handler of a delegated `on<type>:` threw, and it reads `event.currentTarget`: that is the root there,
 * not the element (`getBoundingClientRect` is not a function, a `.value` is undefined). Said once per handler,
 * after the error (the author's decision, docs/v4-direction-2026-10.md §5.2 — a 7GUIs evaluation).
 */
function handlerThrew(engine: Engine, path: string, type: string): void {
  let v: any = engine.target;
  for (const seg of path.split(".")) v = v == null ? undefined : findDescriptor(v, seg)?.value;
  if (typeof v !== "function" || !String(v).includes("currentTarget")) return;
  let said = explained.get(engine);
  if (said === undefined) explained.set(engine, (said = new Set()));
  if (said.has(path)) return;
  said.add(path);
  console.warn(`[@wcstack/state] [wcs/delegated-current-target] "${path}" reads event.currentTarget, the root for a delegated on${type}:. Write on${type}#direct:, or use event.target.closest(…).${LINT_HINT}`);
}

// ---------------------------------------------------------------- $on handlers that use this

/** The `$on` handlers already told about: a re-set state does not say it again. */
const toldThis = new WeakSet<(...args: any[]) => unknown>();
/** `this.x`, `this["x"]`, `const state = this` — not the word in a string (`"this is"`). */
const USES_THIS = /\bthis\s*[.[]|=\s*this\b/;

/**
 * A `$on` handler that uses `this`: it is called as `handler(state, event)`, so `this` is undefined and it
 * throws when the event arrives — a TypeError with no code, which never says why (docs/seam-apps.md,
 * family-ledger). Said once per handler when the state is declared, before any event, as lint's
 * `wcs/on-handler-this` says it.
 */
function onHandlersThis(target: Record<string, any>): void {
  const on = findDescriptor(target, "$on")?.value;
  if (on === null || typeof on !== "object") return;
  for (const name of Object.keys(on)) {
    const fn = on[name];
    if (typeof fn !== "function" || toldThis.has(fn) || !USES_THIS.test(String(fn))) continue;
    toldThis.add(fn);
    console.warn(`[@wcstack/state] [wcs/on-handler-this] The $on handler "${name}" uses this. A $on handler is called as ${name}(state, event): this is undefined there, so it throws when the event arrives — write ${name}(state, event) { state.x = … }.${LINT_HINT}`);
  }
}

// ---------------------------------------------------------------- two root states

/** The roots already told about. */
const toldRoots = new WeakSet<Node>();

const describeState = (e: Element): string => {
  for (const a of ["src", "state", "json"]) if (e.hasAttribute(a)) return `<${e.localName} ${a}${a === "json" ? "" : `="${e.getAttribute(a)}"`}>`;
  return `<${e.localName}>`;
};

/**
 * A root `<wcs-state>` binds a root that has another one: there is one state tree per root, and the one whose
 * state was ready first takes it — a `json=` state, ready at once, before the page's `src=` or inline state that
 * comes first in the document, which is then refused (#47) and the page binds against the wrong state
 * (docs/seam-apps.md, family-ledger). Said once per root, naming both.
 */
function secondRoot(engine: Engine, phase: string): void {
  const el = engine.element as Element | null;
  if (phase !== "mounting" || !el) return;
  const root = el.getRootNode() as Node & ParentNode;
  if (toldRoots.has(root)) return;
  const others = [...root.querySelectorAll(config.tagNames.state)].filter((e) => e !== el && !e.hasAttribute("mount") && !e.hasAttribute("bind-component"));
  if (others.length === 0) return;
  toldRoots.add(root);
  console.warn(`[@wcstack/state] [wcs/second-root] ${others.length + 1} root <wcs-state> elements share one root, and there is one state tree per root: ${describeState(el)} takes it — its state was ready first, whatever the order in the document — and ${others.map(describeState).join(", ")} is refused (#47). Keep one, and graft the others with <wcs-state mount="path">.${LINT_HINT}`);
}

// ---------------------------------------------------------------- bound custom elements never defined

/**
 * How long after the page's `load` — or after a state's bindings are built and its `$connectedCallback` ran,
 * when that is later — a bound custom element may still be undefined. `load` waits for every script the page
 * names, module graphs included: what is missing then is a dynamic import (an autoloader, a lazy route) or a
 * script the page forgot, and a dynamic import on a slow network takes a few seconds (5 s is the timeout
 * `<wcs-defined>`'s README shows for a load failure). The warning says "5 s after the page was ready": keep it
 * in step.
 */
const UNDEFINED_AFTER = 5000;
/** The tags already told about: once per tag, whatever the root. */
const toldTags = new Set<string>();
const lookedAt = new WeakSet<Engine>();

/**
 * The property bindings applied at once on a custom element that is not defined (dom/plan.ts specFor,
 * attachSpec): `attr.` / `class.` / `style.` and an HTML sink. Events (`on…`), `radio:` and `checkbox:` are
 * applied at once too; a spread, a `command.` and an `eventToken.` binding wait, as every other property.
 */
const AT_ONCE = /^(?:(?:attr|class|style)\.|(?:html|innerHTML|outerHTML|srcdoc)$)/;

/**
 * A page element's `data-wcs` (the page walk leaves the attribute on it) has a binding that waits, read with the
 * page walk's parser. One that fails to parse failed the walk already: nothing of it was bound.
 */
function waits(text: string | null): boolean {
  try {
    return text !== null && parseBindTextsForElement(text).some((b) => b.bindingType === "spread" || b.propSegments[0] === "eventToken"
      || (b.bindingType === "prop" && !AT_ONCE.test(b.propName)));
  } catch {
    return false;
  }
}

/**
 * The tags of the elements a row or branch plan binds in a way that waits for a definition (a spec of a custom
 * element but an event's — kind 5, dom/view.ts K_EVENT), in it and in the plans it holds. A row's elements lose
 * their `data-wcs` (the plan holds the bindings): the plans are how they are found.
 */
function planTags(plan: RowPlan, out: Set<string>): void {
  for (const s of plan.specs) {
    if (s.plan !== null) planTags(s.plan, out);
    for (const br of s.branches ?? []) planTags(br.plan, out);
    if (s.custom && s.kind !== 5) {
      let n: Node = plan.fragment;
      for (const i of plan.nodePaths[s.node]) n = n.childNodes[i];
      out.add((n as Element).localName);
    }
  }
}

/**
 * A custom element with bindings that is still not defined: its bindings wait for the definition with no
 * limit (dom/wc.ts whenDefined), text included, and a definition that never comes leaves them unapplied
 * without a word (docs/seam-apps.md, homeroom: a page that did not load `@wcstack/upload/auto` hung at
 * "送信中 0%"). Looked at once per root `<wcs-state>`, UNDEFINED_AFTER after the page was ready: the page's
 * elements whose `data-wcs` has a binding that waits, and the elements of a tag a rendered `for:` / `if:`
 * plan of this state binds so. Not seen: elements added after that look, and those a component's own
 * engine renders in its rows. Said once per tag.
 */
function undefinedElements(engine: Engine): void {
  const tags = new Set<string>();
  for (const l of engine.rootLists.values()) for (const v of [l.view, ...(l.extra ?? [])]) if (v !== null) planTags(v.plan, tags);
  for (const bs of engine.rootBindings.values()) for (const b of bs) for (const br of b.chain?.branches ?? []) planTags(br.plan, tags);
  const attr = config.bindAttributeName;
  // (the node it mounted on, set before "connected")
  for (const el of (engine.root as ParentNode).querySelectorAll("*")) {
    const tag = el.localName;
    // (the registry that defines it: a scoped one of its shadow root, or the global one — dom/wc.ts registryOf)
    if (!tag.includes("-") || toldTags.has(tag) || (((el as any).customElementRegistry ?? customElements) as CustomElementRegistry).get(tag) !== undefined) continue;
    // (`data-wcs-ignore`: nothing in it is bound)
    if (!(tags.has(tag) || waits(el.getAttribute(attr))) || el.closest(`[${attr}-ignore]`) !== null) continue;
    toldTags.add(tag);
    // (which wcstack package defines a `wcs-*` tag is the lint's to say: `wcs-<name>` is not always `@wcstack/<name>`)
    console.warn(`[@wcstack/state] [wcs/element-undefined] <${tag}> is not defined 5 s after the page was ready; its bindings wait for it (property bindings, textContent: included, spreads, commands, event tokens — attr.*, class.*, style.* and on*: apply at once). Load the ${tag.startsWith("wcs-") ? "wcstack package that defines it (its /auto)" : "script that defines it"}.`);
  }
}

/**
 * A root `<wcs-state>` connected (its bindings built, its `$connectedCallback` ran): its root is looked at
 * UNDEFINED_AFTER after the page was ready — its `load`, or this, whichever is later.
 */
function lookLater(engine: Engine, phase: string): void {
  // (not on a server render: @wcstack/server serializes the page long before)
  if (phase !== "connected" || lookedAt.has(engine) || document.documentElement.hasAttribute("data-wcs-server")) return;
  lookedAt.add(engine);
  // (held weakly: a state taken out of the page meanwhile is not kept alive for the look — nor looked at)
  const ref = new WeakRef(engine);
  const look = (): void => void setTimeout(() => {
    const e = ref.deref();
    if ((e?.element as Element | undefined)?.isConnected) undefinedElements(e!);
  }, UNDEFINED_AFTER);
  if (document.readyState === "complete") look();
  else addEventListener("load", look, { once: true });
}

// ---------------------------------------------------------------- pages wcstack does not own

/** The guide to a page wcstack does not own (htmx, Turbo, a widget on another site). */
const ISLANDS_GUIDE = "See https://github.com/wcstack/wcstack/blob/main/docs/islands.md";

/** The roots already told about a copy of drawn markup. */
const toldCopies = new WeakSet<Node>();

/**
 * A root `<wcs-state>` about to bind markup @wcstack/state had already drawn: the marks that stand where its
 * `for:` / `if:` templates were (a template leaves the page when it renders — walkBindings' anchorFor). A copy
 * of a bound page — a history cache that restores the page as it was drawn: htmx's, Turbo's — has no template
 * left to render from and no comment binding left to update: it looks right and never changes
 * (docs/seam-apps.md, community-hall). A server's output marks its rows otherwise (`@@wcs-for…`). Once per root.
 */
function renderedCopy(engine: Engine, phase: string): void {
  const el = engine.element as Element | null;
  if (phase !== "mounting" || !el) return;
  const root = el.getRootNode();
  const container = root.nodeType === 9 ? (root as Document).body : root;
  if (!container || toldCopies.has(root)) return;
  const marks = [config.commentForPrefix, config.commentIfPrefix, config.commentElseIfPrefix, config.commentElsePrefix];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if (!marks.includes((n as Comment).data)) continue;
    toldCopies.add(root);
    console.warn(`[@wcstack/state] [wcs/rendered-copy] ${describeState(el)} binds a copy of a page it had drawn (a <!--${(n as Comment).data}--> mark stands where a template was): a history cache restored the page as drawn (htmx's hx-history, Turbo's snapshot cache), and its lists, branches and texts never change. Turn that cache off for the page: hx-history="false" on <body>, <meta name="turbo-cache-control" content="no-cache">. ${ISLANDS_GUIDE}`);
    return;
  }
}

/**
 * How long an element with bindings may be in a bound root without being bound: whoever inserts markup hands
 * it over right after (the router at once, htmx on htmx:load). Also the least time between two looks.
 */
const UNBOUND_AFTER = 1000;
const watchedRoots = new WeakSet<Engine>();
/** The roots already told about an element nothing bound. */
const toldUnbound = new WeakSet<Node>();
/** A structural template's binding: handed over at the top of inserted content, it is refused without a range (#204). */
const STRUCTURAL = /^\s*(?:for|if|elseif|else)\s*:/;
/** A binding that sets an element's content: what it puts there is a value, not markup (walkBindings). */
const CONTENT = /(?:^|;)\s*(?:html|innerHTML|textContent|innerText|outerHTML|outerText)\s*[:#]/;

/**
 * After a root's walk, @wcstack/state binds only what is handed over to it (the binder protocol): markup another
 * library inserts — htmx's swaps, a Turbo frame, an innerHTML — keeps its `data-wcs` and does nothing, without
 * a word, and so does what is inserted into a container the page already had and handed over as that container
 * (walked once, it is left alone) (docs/seam-apps.md, community-hall). Once its bindings are built, a root is
 * looked at UNBOUND_AFTER after its content changes: an element with bindings that entered it since and that no
 * walk took is said once per root (one there when it was bound and not walked is not: the walk stopped at an
 * error, which was reported). Rows and branches carry no `data-wcs` (compilePlan takes it), so
 * one query finds only page markup. Not looked at: what a binding put in an element as a value (`html:` and
 * the content bindings), a Light DOM component's content (its own state binds it), `data-wcs-ignore`.
 */
function watchUnbound(engine: Engine, phase: string): void {
  const el = engine.element as Element | null;
  if (phase !== "connected" || !el || watchedRoots.has(engine) || document.documentElement.hasAttribute("data-wcs-server")) return;
  watchedRoots.add(engine);
  const root = el.getRootNode();
  const container = (root.nodeType === 9 ? (root as Document).body : root) as (Node & ParentNode) | null;
  if (!container) return;
  // the engine, the root and its container held weakly — a look still pending when the page is taken out keeps
  // nothing of it alive (e2e/tests/state-address-gc.spec.ts) — and what was there when the root was bound
  const e = new WeakRef(engine);
  const r = new WeakRef(root);
  const c = new WeakRef(container);
  const present = new WeakSet(container.querySelectorAll(`[${config.bindAttributeName}]`));
  let due = false;
  const observer = new MutationObserver(() => {
    if (due) return;
    due = true;
    setTimeout(() => {
      due = false;
      lookUnbound(e, r, c, present, observer);
    }, UNBOUND_AFTER);
  });
  // (quoted: `childList` is a name the build shortens — mangle.mjs — the observer's option is not)
  observer.observe(container, { "childList": true, subtree: true });
}

function lookUnbound(e: WeakRef<Engine>, r: WeakRef<Node>, c: WeakRef<Node & ParentNode>, present: WeakSet<Element>, observer: MutationObserver): void {
  const root = r.deref();
  const container = c.deref();
  if (root === undefined || container === undefined || !(e.deref()?.element as Element | undefined)?.isConnected || toldUnbound.has(root)) {
    observer.disconnect();
    return;
  }
  const x = unboundIn(container, present);
  if (x === null) return;
  toldUnbound.add(root);
  observer.disconnect();
  const attr = config.bindAttributeName;
  const text = x.getAttribute(attr)!;
  console.warn(`[@wcstack/state] [wcs/inserted-unbound] <${x.localName} ${attr}="${text.length > 60 ? `${text.slice(0, 57)}...` : text}"> entered the page after it was bound, and nothing bound it: its bindings do nothing. The page is walked once; after that only markup handed over is bound: whoever inserts it (htmx, a Turbo frame, an innerHTML) calls globalThis[Symbol.for("wcstack.binder")].bind(node) for each new node — not for a container the page already had.${STRUCTURAL.test(x.localName === "template" ? text : "") ? " A for: / if: template at the top of what is handed over needs { range: true } (#204): put it inside an element." : ""} ${ISLANDS_GUIDE}`);
}

/** The first element under `container` with bindings, not `present` before, that no walk took (or null). */
function unboundIn(container: ParentNode, present: WeakSet<Element>): Element | null {
  const attr = config.bindAttributeName;
  next: for (const x of container.querySelectorAll(`[${attr}]`)) {
    if (walked.has(x) || present.has(x) || x.closest(`[${attr}-ignore]`) !== null) continue;
    for (let p = x.parentElement; p !== null; p = p.parentElement) {
      if (hooks.componentScope?.(p) || CONTENT.test(p.getAttribute(attr) ?? "")) continue next;
    }
    return x;
  }
  return null;
}

// ---------------------------------------------------------------- for: over a value that is not an array

/** The lists already told about, by pattern. */
const toldLists = new WeakSet<Pattern>();

/**
 * A list a `for:` renders whose value is neither an array nor null / undefined: it renders no rows, without a
 * word (a number written through createStateAsync — docs/seam-apps.md, homeroom). Said once per list path, with
 * the lint's code for the same mistake. Looked at when a list syncs to a value that changes its rows (its first
 * value, and one that replaces an array: listSynced), and, after each drain, for the lists outside any row (one
 * that replaces null or another value that was not an array). A list in a row whose value was null and then is
 * not an array is not seen: its sync calls no hook (`reconcile` finds nothing changed).
 */
function listValue(engine: Engine, l: StateList): void {
  const p = l.pattern;
  if (toldLists.has(p) || l.rows.length > 0) return;
  let v: unknown;
  try {
    v = engine.readUntracked(p, l.parentRow);
  } catch {
    // (a list whose path fails to read is its for binding's failure, reported already)
    return;
  }
  if (v == null || Array.isArray(v)) return;
  // (a list syncs before the view that renders it takes it: looked at once the walk that made it is done)
  queueMicrotask(() => {
    if (l.view === null || toldLists.has(p)) return;
    toldLists.add(p);
    console.warn(`[@wcstack/state] [wcs/binding-type-expectation] "for: ${p.path}" needs an array, not ${was(v)}: it renders no rows (null and undefined render none on purpose).${LINT_HINT}`);
  });
}

/**
 * A drain made patterns (`loose`, before its sweep): a getter may have read a path for the first time — in a
 * row added since, or down a branch of its own code. Checked as the bindings' are; a drain that read no new
 * path schedules nothing. Then the lists outside any row that a `for:` renders (listValue).
 */
function drained(engine: Engine): void {
  if (named.has(engine) && ((engine as any).loose as Pattern[]).length > 0) schedule(engine);
  // (a list whose first sync failed, a missing key, has no value to look at)
  for (const l of engine.rootLists.values()) if (l.view !== null && l.arr !== null) listValue(engine, l);
}

// ---------------------------------------------------------------- undefined after a value on an element's input

/** The bindings already told about (once per binding). */
const toldInputs = new WeakSet<Binding>();

/**
 * A binding to a custom element's input whose value goes from a value to undefined: state never writes undefined
 * to an element's input (B8, dom/view.ts Binding.apply), so the element keeps the value it had while the page
 * says otherwise — a parent replaced by an object without the key (a stored sound saved before the key existed,
 * a link without the value), a getter that starts returning undefined, a filter that gives it
 * (docs/seam-apps.md, music-room). Said once per binding, with what the element keeps (its property; nothing when
 * that reads undefined, as after the element wrote undefined itself). null is written, so a value then null is
 * not told about, nor null then undefined, nor a binding that never had a value. Seen where the value and the
 * one before it meet — the binding's apply, wrapped here (0 B in the core): every change of the value goes through it.
 */
function watchInputs(): void {
  const proto = Binding.prototype;
  const apply = proto.apply;
  proto.apply = function (this: Binding): void {
    const before = this.value;
    apply.call(this);
    if (before != null && this.value === undefined && this.kind === K_CUSTOM) inputUndefined(this);
  };
}

function inputUndefined(b: Binding): void {
  const el = b.node as Element;
  const kept = (el as any)[b.name];
  if (kept === undefined || toldInputs.has(b)) return;
  toldInputs.add(b);
  const p = b.pattern.path;
  console.warn(`[@wcstack/state] [wcs/input-undefined] "${b.name}: ${p}" on <${el.localName}> is undefined after a value, and state never writes undefined to an element's input: <${el.localName}> keeps ${was(kept)}. Write null to clear it (a wcstack I/O node goes back to its default), or give "${p}" a value.`);
}

/** A re-set: every path is checked again against the new state. */
function recheck(engine: Engine): void {
  checked.delete(engine);
  if (named.has(engine)) schedule(engine);
}

// ---------------------------------------------------------------- recursion's static checks

/**
 * `$recursion` families that can never work (approved simplification: these checks moved out of
 * the core): a suffix naming the recursion structure itself, two families one of which is the
 * other a few repeats deeper, and a concrete key that one of the families expands to.
 */
function checkRecursion(target: Record<string, any>): void {
  const decl = target.$recursion;
  if (decl === null || typeof decl !== "object") return;
  const entries = Object.entries(decl);
  if (entries.length !== 1 || typeof entries[0][1] !== "string") return;
  const [anchor, repeat] = entries[0] as [string, string];
  if (!anchor.endsWith(".*") || !repeat.endsWith(".*")) return;
  const list = anchor.slice(0, -2);
  const key = repeat.slice(0, -2);
  const step = `.${repeat}`;
  const head = `${list}.**`;
  const keys = keysOf(target);
  const families = keys.filter((k) => k.startsWith(head)).map((k) => k.slice(head.length));
  const bad = (why: string): never => raiseError(`[wcs/recursion-declaration-invalid] ${why}`);
  for (const s of families) {
    if (s === `.${key}` || s.startsWith(`.${key}.`)) {
      bad(`"${head}${s}" names the recursion structure itself (the "${key}" lists): recursive getters compute values over the nodes.`);
    }
    for (const t of families) {
      if (t.length > s.length && t.endsWith(s) && new RegExp(`^(?:${esc(step)})+$`).test(t.slice(0, t.length - s.length))) {
        bad(`"${head}${s}" and "${head}${t}" expand to the same concrete path at different depths (they differ by whole repetitions of "${repeat}"). Rename one of them.`);
      }
    }
    const re = new RegExp(`^${esc(anchor)}(?:${esc(step)})*${esc(s)}$`);
    for (const k of keys) {
      if (!k.includes("**") && re.test(k)) bad(`"${k}" is already defined on the state, so the recursive getter "${head}${s}" cannot expand to it.`);
    }
  }
}

/**
 * One accessor declared for several paths (`get "users.*.fullname,employees.*.fullname"()`, 4.22): the paths
 * are separated by "," alone. The core splits at each comma and takes what is between as it is, so a space
 * or an empty entry declares a path nothing reads — refused here, as the lint refuses it.
 */
function accessorLists(target: object): void {
  for (const k of keysOf(target)) {
    if (!k.includes(",")) continue;
    const d = findDescriptor(target, k)!;
    if (d.get === undefined && d.set === undefined) continue;
    const paths = k.split(",");
    if (paths.some((p) => p === "" || /\s/.test(p))) {
      raiseError(`[wcs/accessor-list-syntax] "${k}": the paths of one accessor are separated by "," alone: no space, no empty entry.`);
    }
    accessorListPaths(k, paths, d);
  }
}

/** The accessors declared for several paths already told about (a re-set declares them again). */
const toldAccessorLists = new WeakSet<object>();

/**
 * An accessor declared for several lists whose body names the rows of one of them by a full path
 * (`this["users.*.first"]` in `get "users.*.full,employees.*.full"()`): at the rows of the other lists that
 * path has no row — a read gives undefined, a write throws — and the page shows it only there. Read off the
 * accessor's source when the state is declared, as lint's `wcs/accessor-list-path` reads it: `this[...]` with
 * a literal path (`$getAll("users.*.first", [])` names its rows itself). Said once per accessor.
 */
function accessorListPaths(key: string, paths: string[], d: PropertyDescriptor): void {
  const fn = (d.get ?? d.set)!;
  if (toldAccessorLists.has(fn)) return;
  // the row each path is of: `users.*` for `users.*.full`, "" for a path with no `*`
  const rows = paths.map((p) => p.slice(0, p.lastIndexOf("*") + 1));
  const source = `${d.get ?? ""}${d.set ?? ""}`;
  for (const row of new Set(rows)) {
    // a path of the list whose rows do not have this row: neither the same one, nor one above theirs
    const other = paths.find((_, i) => rows[i] !== row && !rows[i].startsWith(`${row}.`));
    const found = row === "" || other === undefined ? null : new RegExp(`\\[\\s*["'\`](${esc(row)}\\.[^"'\`]*)["'\`]`).exec(source);
    if (found === null) continue;
    toldAccessorLists.add(fn);
    console.warn(`[@wcstack/state] [wcs/accessor-list-path] The accessor "${key}" names "${found[1]}" by its full path, and it is also declared for "${other}": at its rows that path has no row, so a read gives undefined and a write throws. Write it relative to the row: this["${found[1].slice(row.length)}"].${LINT_HINT}`);
    return;
  }
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let trustedTypesReported = false;

/**
 * An HTML sink write Trusted Types blocked: the browser's message names no fix, so say once
 * per page what to install (the same report as @wcstack/state 3.3).
 */
function failed(_engine: Engine, error: unknown, binding: Binding): void {
  const prop = binding.name === "html" ? "innerHTML" : binding.name;
  if (trustedTypesReported || !(error instanceof TypeError) || !isHtmlSink(prop) || !("trustedTypes" in globalThis)) return;
  trustedTypesReported = true;
  const cause = typeof getTrustedTypesPolicy()?.createHTML === "function"
    ? "The injected policy's createHTML() did not return a TrustedHTML."
    : "No sanitizing policy is installed, and @wcstack/state deliberately does not pass state values through an identity policy — that would defeat the CSP.";
  console.error(
    `[@wcstack/state] Writing to "${prop}" was blocked by Trusted Types (require-trusted-types-for 'script'). ${cause}\n`
    + `Install a sanitizing policy before the first binding is applied:\n`
    + `  globalThis[Symbol.for("wcstack.trustedTypes.policy")] =\n`
    + `    trustedTypes.createPolicy("my-app", { createHTML: (s) => DOMPurify.sanitize(s) });\n`
    + `Or bind the value as text instead of HTML. See docs/csp.md section 7.`,
    { element: binding.node, property: prop },
  );
}

// ---------------------------------------------------------------- the default getter

const warnedDetail = new WeakMap<Element, Set<string>>();

/**
 * A wc-bindable property's event read with the default getter (`e.detail`): warns once per
 * element and property about the two shapes that cannot be what the element meant (README
 * "What the element writes back", as @wcstack/state 3.3). The write is applied as it is.
 * (a) no detail while the element's property has a value — a plain Event, or a forgotten detail;
 * (b) a detail object with a `<name>` key while the property is not an object — a wrapper.
 */
function detail(el: Element, name: string, v: unknown): void {
  const prop = (el as any)[name];
  const reason = v === undefined
    ? prop === undefined ? null : `the event carried no detail (undefined) while element.${name} is ${typeof prop}`
    : v !== null && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, name) && (prop === null || typeof prop !== "object")
      ? `the event's detail is an object with a "${name}" key while element.${name} is ${typeof prop}`
      : null;
  if (reason === null) return;
  let said = warnedDetail.get(el);
  if (said === undefined) warnedDetail.set(el, (said = new Set()));
  if (said.has(name)) return;
  said.add(name);
  console.warn(
    `[@wcstack/state] [wcs/default-getter-mismatch] <${el.localName}> "${name}": ${reason}. `
    + "With no getter, state receives e.detail as-is. Dispatch the value itself as detail, or declare "
    + `getter (e.g. (e) => e.detail.${name}, or (e) => e.target.${name}) on that wcBindable property.`,
  );
}

// ---------------------------------------------------------------- 3.x names 4.0 removed

/**
 * Declarations 3.2 renamed, whose old names 4.0 removed: a declaration under one would do nothing.
 * (The core detected these and the two APIs below up to 4.0.0-rc.3; without this add-on they are
 * ignored like any other unknown `$` key.)
 */
const REMOVED_DECLARATIONS: [string, string][] = [["$streams", "$stream"], ["$updatedCallback", "$renderedCallback"]];
/** APIs 3.2 renamed, whose old names 4.0 removed: reading one fails with the name to write. */
const REMOVED_APIS: Readonly<Record<string, string>> = { "$trackDependency": "$dependOn", "$untrackDependency": "$untracked" };

/** A state that declares a 3.x name 4.0 removed (`$scan` has no successor: $watch or $on). */
function removedDeclarations(target: Record<string, any>): void {
  if (target.$scan !== undefined) raise(M.ScanRemoved);
  for (const [old, name] of REMOVED_DECLARATIONS) if (target[old] !== undefined) raise(M.DeclarationRemoved, [old, name]);
}

export const diagnostics: Feature = {
  name: "diagnostics",
  hooks,
  install(): void {
    hooks.explain = explain;
    hooks.render = render;
    hooks.declared = declared;
    hooks.detail = detail;
    hooks.failed = chain(hooks.failed, failed);
    // the removed names first, before what is installed (the core checked them before it took the
    // state in): a refused state never reaches the other add-ons' runtimes
    const prev = hooks.declare;
    hooks.declare = (engine, target) => {
      removedDeclarations(target);
      prev?.(engine, target);
      checkRecursion(target);
      accessorLists(target);
      onHandlersThis(target);
      recheck(engine);
      watchPostUpdate(engine);
      watchCommands(engine);
      declaredKeys.set(engine, new Set(keysOf(target)));
    };
    hooks.handlerThrew = handlerThrew;
    hooks.element = chain(chain(chain(chain(hooks.element, secondRoot), renderedCopy), lookLater), watchUnbound);
    hooks.written = chain(chain(chain(hooks.written, written), elementWrote), setterWrote);
    hooks.drained = chain(chain(hooks.drained, drained), setterDrained);
    hooks.beforeWrite = first(handled, hooks.beforeWrite, beforeSetter);
    hooks.listSynced = chain(chain(hooks.listSynced, listValue), rowsArrived);
    hooks.dollar = first(known, hooks.dollar, (_engine, key) => (Object.hasOwn(REMOVED_APIS, key) ? raise(M.ApiRemoved, [key, REMOVED_APIS[key]]) : undefined));
    watchInputs();
  },
};
export default diagnostics;
