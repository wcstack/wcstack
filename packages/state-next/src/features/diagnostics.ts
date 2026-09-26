/**
 * The diagnostics add-on (@wcstack/state/features/diagnostics): the sentences and the self-fix
 * guidance of error messages. The core states the code, the message number and the values
 * (`[wcs/index-arity] #901 "$resolve" "m.*.*" 2 1`); with this installed, the message is the
 * sentence (`[wcs/index-arity] $resolve("m.*.*") takes 2 index(es), got 1.`), followed by the
 * nearest name (did-you-mean, the same rule as lint), how to fix it, and a pointer to lint where
 * lint really detects the case. The full `auto` bundle installs it.
 */
import { addHook, hooks, type Feature } from "../hooks";
import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import { raiseError } from "../parser/raiseError";
import type { Binding } from "../dom/view";
import { getTrustedTypesPolicy, isHtmlSink } from "../trustedTypes";
import { didYouMean, LINT_HINT } from "../diagnostics/guidance";
import { explain, render } from "../diagnostics/explain";

// ---------------------------------------------------------------- paths that do not resolve

/** Paths bindings and `$watch` keys named, by engine: checked one macrotask later (and after a re-set). */
const named = new WeakMap<Engine, Map<Pattern, boolean>>();
const checked = new WeakMap<Engine, Set<Pattern>>();
const due = new WeakSet<Engine>();

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
 * The segment of `p` that certainly does not exist, with the names that do at its level; null
 * when the path exists or it cannot be told without evaluating a getter (a getter on the way, a
 * null or primitive on the way, a list with no row to look into).
 */
function missing(engine: Engine, p: Pattern): { seg: string; names: string[] } | null {
  const chain: Pattern[] = [];
  for (let q: Pattern | null = p; q !== null; q = q.parent) chain.unshift(q);
  let v: any = engine.target;
  for (const q of chain) {
    if (q.getter !== null) return null;
    if (v === null || typeof v !== "object") return null;
    if (q.last === "*") {
      if (!Array.isArray(v) || v.length === 0) return null;
      v = v[0];
      continue;
    }
    if (Array.isArray(v) && /^\d+$/.test(q.last)) {
      // an explicit index: only a row that is there can be looked into
      if (Number(q.last) >= v.length) return null;
      v = v[Number(q.last)];
      continue;
    }
    const d = findDescriptor(v, q.last);
    if (d === undefined) {
      const names = keysOf(v);
      // getters declared one level under the same parent (`items.*.subtotal`)
      for (const g of engine.patterns.all()) if (g.parent === q.parent && g.getter !== null) names.push(g.last);
      return { seg: q.last, names };
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
  for (const [p, watch] of map) {
    if (done.has(p)) continue;
    done.add(p);
    const m = missing(engine, p);
    if (m === null) continue;
    const [code, subject] = watch ? ["watch-path-missing", "$watch path"] : ["binding-path-missing", "Bound path"];
    console.warn(`[@wcstack/state] [wcs/${code}] ${subject} "${p.path}" does not resolve on the state tree: "${m.seg}" is not declared.${didYouMean(m.seg, m.names)} Updates to this path will be silently dropped.${LINT_HINT}`);
  }
}

function schedule(engine: Engine): void {
  if (due.has(engine)) return;
  due.add(engine);
  setTimeout(() => check(engine), 0);
}

/** The `declared` hook: a path a binding or a `$watch` key names. */
function declared(engine: Engine, p: Pattern, watch = false): void {
  // a missing top-level key already fails the binding's read (the core's error)
  if (p.path[0] === "$" || p.path.includes("#") || (!watch && p.parent === null)) return;
  let map = named.get(engine);
  if (map === undefined) named.set(engine, (map = new Map()));
  if (!map.has(p)) map.set(p, watch);
  schedule(engine);
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

export const diagnostics: Feature = {
  name: "diagnostics",
  install(): void {
    hooks.explain = explain;
    hooks.render = render;
    hooks.declared = declared;
    addHook("failed", failed);
    addHook("declare", (engine, target) => {
      checkRecursion(target);
      recheck(engine);
    });
  },
};
export default diagnostics;
