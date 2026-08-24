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
let counter = 0;
let assignedCount = 0;
let warned = false;

// テスト用: モジュールスコープのカウンタを初期化する
export function __test_resetTransitionNaming(): void {
  counter = 0;
  assignedCount = 0;
  warned = false;
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
  if (assignedCount >= naming.limit) {
    if (!warned) {
      warned = true;
      console.warn(
        `[@wcstack/state] auto view-transition-name limit (${naming.limit}) reached; ` +
        "further elements are left unnamed. Raise naming-limit on <wcs-view-transition>, " +
        'or switch to naming="manual" and name only what should morph.',
      );
    }
    return;
  }
  namedElements.add(element);
  assignedCount += 1;
  counter += 1;
  const style = (element as HTMLElement).style;
  if (style === undefined) {
    return;
  }
  style.setProperty("view-transition-name", `wcs-${kind}-${counter}`);
  // Group handle for CSS (`::view-transition-group(*.wcs-row)`). Ignored by
  // engines that predate view-transition-class, which costs nothing.
  style.setProperty("view-transition-class", `wcs-${kind}`);
}
