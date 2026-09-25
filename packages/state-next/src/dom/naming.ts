import { getTransitionRunner } from "../protocol/transitionRunner";

/**
 * Automatic `view-transition-name` (docs/view-transition-design.md §6), as @wcstack/state
 * does it: when the page's arbiter declares `naming="auto"`, the first element of every
 * row and `if` branch built gets a unique name. A name must be on the element before the
 * browser snapshots the old state, so it is given when the block is built, never renamed,
 * and capped (each named element is a snapshot group of its own).
 *
 * The ledger is per document (a `Symbol.for` slot shared with @wcstack/state), so two
 * bundles on one page never mint the same name.
 */
interface Ledger {
  counter: number;
  assigned: number;
  warned: boolean;
}

const LEDGER_KEY = Symbol.for("wcstack.state.view-transition-naming");
const named = new WeakSet<Element>();

/** The naming cap when the arbiter names automatically, or -1 (the author names). */
export function autoNaming(): number {
  const runner = getTransitionRunner("state");
  return runner !== null && runner.naming === "auto" ? runner.namingLimit : -1;
}

/** Names the first element of `nodes` (`wcs-row-3`, `wcs-branch-7`), within the cap. */
export function nameBlock(first: ChildNode, nodes: ChildNode[] | null, kind: "row" | "branch", limit: number): void {
  let el: Element | null = null;
  if (nodes === null) el = first.nodeType === 1 ? (first as Element) : null;
  else for (let i = 0; i < nodes.length && el === null; i++) if (nodes[i].nodeType === 1) el = nodes[i] as Element;
  const style = (el as HTMLElement | null)?.style;
  if (el === null || style === undefined || named.has(el)) return;
  const ledger = ((globalThis as any)[LEDGER_KEY] ??= { counter: 0, assigned: 0, warned: false }) as Ledger;
  if (ledger.assigned >= limit) {
    if (!ledger.warned) {
      ledger.warned = true;
      console.warn(`[@wcstack/state] auto view-transition-name limit (${limit}) reached; the rest are unnamed (naming-limit on <wcs-view-transition>).`);
    }
    return;
  }
  named.add(el);
  ledger.assigned++;
  style.setProperty("view-transition-name", `wcs-${kind}-${++ledger.counter}`);
  style.setProperty("view-transition-class", `wcs-${kind}`);
}
