import { getTransitionRunner } from "../protocol/transitionRunner";
import { IContent } from "../structural/types";

/**
 * Automatic `view-transition-name` assignment (docs/view-transition-design.md §6).
 *
 * A name has to be on the element *before* the browser snapshots the old state,
 * so it cannot be assigned inside the transition's update callback — "name only
 * what changed" is impossible. The names are therefore assigned as structural
 * content mounts, and only when the page's arbiter declares `naming="auto"`.
 *
 * The name follows the *content*, not the row's data: a pooled content reused for
 * another item keeps its name, which is exactly what the DOM does, so the
 * transition morphs the element that really was reused.
 */
export interface IAutoNaming {
  readonly limit: number;
}

export type TransitionNameKind = "row" | "branch";

/** Elements that already carry a generated name (never renamed). */
const namedElements = new WeakSet<Element>();

/**
 * The generated-name ledger is per *document*, not per module instance.
 *
 * `view-transition-name` has to be unique across the whole document: the moment
 * two elements share one, the browser aborts the transition outright. A
 * module-scope counter breaks that as soon as `@wcstack/state` is loaded twice on
 * one page (two CDN bundles), because both copies would start minting
 * `wcs-row-1`. The transition-runner key is a `Symbol.for` for exactly this
 * reason, and the counter needs the same protection.
 *
 * Sharing the cap is right for the same reason: the cost a cap exists to bound —
 * one snapshot group per named element — is a document-wide cost, not a
 * per-bundle one.
 */
const NAMING_LEDGER_KEY = Symbol.for("wcstack.state.view-transition-naming");

interface INamingLedger {
  counter: number;
  assigned: number;
  warned: boolean;
}

function getLedger(): INamingLedger {
  const slot = globalThis as Record<symbol, INamingLedger | undefined>;
  return (slot[NAMING_LEDGER_KEY] ??= { counter: 0, assigned: 0, warned: false });
}

// テスト用: ドキュメント単位の命名台帳を初期化する
export function __test_resetTransitionNaming(): void {
  const ledger = getLedger();
  ledger.counter = 0;
  ledger.assigned = 0;
  ledger.warned = false;
}

/**
 * The active auto-naming policy, or null when names are the author's business
 * (the default) — one arbiter lookup per structural apply, not per row.
 */
export function getAutoNaming(): IAutoNaming | null {
  const runner = getTransitionRunner("state");
  if (runner === null || runner.naming !== "auto") {
    return null;
  }
  return { limit: runner.namingLimit };
}

function firstElementOf(content: IContent): Element | null {
  const first = content.firstNode;
  if (first === null) {
    return null;
  }
  const last = content.lastNode;
  for (let node: Node | null = first; node !== null; node = node.nextSibling) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node as Element;
    }
    if (node === last) {
      break;
    }
  }
  return null;
}

/**
 * Give this content's first element a unique name plus a class for group
 * styling, unless it already has one or the cap has been reached.
 *
 * The cap exists because every named element becomes its own snapshot group; a
 * few hundred of them make a transition visibly slow. Past it naming stops and
 * says so once — silently degrading would leave the author wondering why only
 * the first part of a list animates.
 */
export function applyTransitionName(
  content: IContent,
  kind: TransitionNameKind,
  naming: IAutoNaming,
): void {
  const element = firstElementOf(content);
  if (element === null || namedElements.has(element)) {
    return;
  }
  // A node without `style` (anything outside HTMLElement / SVGElement) cannot
  // carry a name. Bail before touching the ledger: consuming the cap and marking
  // the element as named would burn a slot for a name that was never written,
  // and leave that element permanently ineligible.
  const style = (element as HTMLElement).style;
  if (style === undefined) {
    return;
  }
  const ledger = getLedger();
  if (ledger.assigned >= naming.limit) {
    if (!ledger.warned) {
      ledger.warned = true;
      console.warn(
        `[@wcstack/state] auto view-transition-name limit (${naming.limit}) reached; ` +
        "further elements are left unnamed. Raise naming-limit on <wcs-view-transition>, " +
        'or switch to naming="manual" and name only what should morph.',
      );
    }
    return;
  }
  namedElements.add(element);
  ledger.assigned += 1;
  ledger.counter += 1;
  style.setProperty("view-transition-name", `wcs-${kind}-${ledger.counter}`);
  // Group handle for CSS (`::view-transition-group(*.wcs-row)`). Ignored by
  // engines that predate view-transition-class, which costs nothing.
  style.setProperty("view-transition-class", `wcs-${kind}`);
}
