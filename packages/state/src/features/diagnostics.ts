/**
 * The diagnostics add-on (@wcstack/state/features/diagnostics): the sentences and the self-fix
 * guidance of error messages. The core states the message number and the values
 * (`#901 "$resolve" "m.*.*" 2 1`); with this installed, the message is the code shared with lint
 * and the sentence (`[wcs/index-arity] $resolve("m.*.*") takes 2 index(es), got 1.`), followed by the
 * nearest name (did-you-mean, the same rule as lint), how to fix it, and a pointer to lint where
 * lint really detects the case. The full `auto` bundle installs it.
 */
import { chain, first, hooks, known, type Feature } from "../hooks";
import type { Engine } from "../engine";
import { parsePath, type Pattern } from "../pattern";
import { raiseError } from "../parser/raiseError";
import { config } from "../config";
import type { WcsState } from "../element";
import type { Binding } from "../dom/view";
import { getTrustedTypesPolicy, isHtmlSink } from "../trustedTypes";
import { didYouMean, LINT_HINT } from "../diagnostics/guidance";
import { explain, render } from "../diagnostics/explain";
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

/**
 * The segment of `p` that certainly does not exist, with the names that do at its level; null
 * when the path exists or it cannot be told without evaluating a getter (a getter on the way, a
 * null or primitive on the way, a list with no row to look into).
 */
function missing(engine: Engine, p: Pattern): { seg: string; names: string[]; row: boolean } | null {
  const chain: Pattern[] = [];
  for (let q: Pattern | null = p; q !== null; q = q.parent) chain.unshift(q);
  const named = (q: Pattern | null): Pattern | null | undefined => (q === null ? null : wildcardForm(engine, q));
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
    const m = missing(engine, p);
    if (m === null) continue;
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

/**
 * A drain made patterns (`loose`, before its sweep): a getter may have read a path for the first time — in a
 * row added since, or down a branch of its own code. Checked as the bindings' are; a drain that read no new
 * path schedules nothing.
 */
function drained(engine: Engine): void {
  if (named.has(engine) && ((engine as any).loose as Pattern[]).length > 0) schedule(engine);
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
      onHandlersThis(target);
      recheck(engine);
      watchPostUpdate(engine);
      watchCommands(engine);
      declaredKeys.set(engine, new Set(keysOf(target)));
    };
    hooks.handlerThrew = handlerThrew;
    hooks.element = chain(hooks.element, secondRoot);
    hooks.written = chain(chain(hooks.written, written), elementWrote);
    hooks.drained = chain(hooks.drained, drained);
    hooks.dollar = first(known, hooks.dollar, (_engine, key) => (Object.hasOwn(REMOVED_APIS, key) ? raise(M.ApiRemoved, [key, REMOVED_APIS[key]]) : undefined));
  },
};
export default diagnostics;
