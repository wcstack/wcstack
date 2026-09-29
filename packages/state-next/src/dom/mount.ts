import type { Engine } from "../engine";
import { hooks } from "../hooks";
import { elementSpecs, textSpec, walkBindings } from "./plan";
import { attachChain, attachSpec, ForView, listFor } from "./view";

/** The engine mounted on each root (document, shadow root): the binder's lookup. */
export const engines = new WeakMap<Node, Engine>();

/**
 * Elements outside any block whose data-wcs is bound: walking a subtree again (the binder
 * protocol hands over route content on every insertion) leaves them alone. Blocks need no
 * record — their plans drop the attribute, so a rendered row carries nothing to bind.
 */
const bound = new WeakSet<Element>();

/** Binds everything under `root` to `engine` and renders it. */
export function mount(engine: Engine, root: Document | ShadowRoot | Element): void {
  const container: Node = root.nodeType === 9 ? (root as Document).body : root;
  engine.root = root;
  engines.set(root, engine);
  walk(engine, Array.from(container.childNodes));
  engine.report();
}

/** Binds a subtree that entered the document after the mount (the binder protocol). */
export function mountSubtree(engine: Engine, subtree: Element): void {
  walk(engine, [subtree]);
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
    (el, text) => {
      if (bound.has(el)) return;
      bound.add(el);
      for (const spec of elementSpecs(engine, text, null, el, 0)) attachSpec(engine, spec, el, null, null);
    },
    (node, expr) => {
      hooks.ssrMark?.(engine, node, expr);
      attachSpec(engine, textSpec(engine, expr, null, 0), node, null, null);
    });
}
