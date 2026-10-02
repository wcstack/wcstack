import type { Engine } from "../engine";
import { hooks } from "../hooks";
import { directive, textSpec, walkBindings } from "./plan";
import { raise, M } from "../messages";
import { attachChain, attachSpec, ForView, listFor } from "./view";

/** The engine mounted on each root (document, shadow root): the binder's lookup. */
export const engines = new WeakMap<Node, Engine>();

/**
 * Binds everything under `root` to `engine` and renders it. An element walked once is left
 * alone after (walkBindings): the binder protocol hands route content over on every insertion.
 */
export function mount(engine: Engine, root: Document | ShadowRoot | Element): void {
  const container: Node = root.nodeType === 9 ? (root as Document).body : root;
  engine.root = root;
  engines.set(root, engine);
  walk(engine, [...container.childNodes]);
  engine.report();
}

/**
 * Binds a subtree that entered the document after the mount (the binder protocol). It never throws
 * for markup reasons (the protocol): an error in the markup is reported, and what is before it in
 * document order (the elements it is in too) stays bound. A structural template handed over itself (a
 * route's top-level node) is rendered only when the caller carries its range (`range`: the router
 * takes everything up to its end mark along, the rows rendered beside the template included);
 * otherwise it is refused (#204): what it renders would sit beside it, where whoever inserted it
 * does not reach (an older router removes only its own nodes, `<wcs-head>` its one element). An
 * `if:` template handed over reads its `elseif:` / `else:` siblings into one chain (readChain), and
 * those, handed over next, are out of the document by then (their anchors took their place).
 */
export function mountSubtree(engine: Engine, subtree: Element, range?: boolean): void {
  try {
    const d = subtree.localName === "template" ? directive(subtree) : null;
    if (d !== null && !range) raise(M.TemplateHandedOver, [d.bindingType]);
    walk(engine, [subtree]);
  } catch (e) {
    console.error(e);
  }
  engine.report();
}

function walk(engine: Engine, children: ChildNode[]): void {
  walkBindings(engine, children, null, true,
    (anchor, p, plan) => {
      new ForView(engine, plan, listFor(engine, p, null, anchor), anchor).update();
    },
    (branches) => {
      attachChain(engine, branches, null, null);
    },
    (el, specs) => {
      hooks.ssrMark?.(engine, el, specs);
      for (const spec of specs) attachSpec(engine, spec, el, null, null);
    },
    (node, expr) => {
      hooks.ssrMark?.(engine, node, expr);
      attachSpec(engine, textSpec(engine, expr, null, 0), node, null, null);
    });
}
