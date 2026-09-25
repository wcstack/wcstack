import type { Engine } from "../engine";
import { config } from "../config";
import { raiseError } from "../parser/raiseError";
import { hooks } from "../hooks";
import { bindAttr, compilePlan, directive, elementSpecs, notAfterIf, readChain, splitMustache, textSpec } from "./plan";
import { attachChain, attachCustomOrPlain, attachEvent, Binding, ForView, K_COMMAND, K_EVENT, K_EVTTOKEN, K_PROP, K_SPREAD, listFor, type Spec } from "./view";
import { attachCommand, attachEventToken, attachSpread, whenDefined } from "./wc";

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
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1) {
      const el = child as Element;
      const tag = el.localName;
      if (tag === "script" || tag === "style") continue;
      // markup written inside a <wcs-state> is part of the page (its own attributes are not bindings)
      if (tag === config.tagNames.state) {
        walk(engine, Array.from(el.childNodes));
        continue;
      }
      if (tag === "template") {
        const d = directive(el);
        if (d === null) continue;
        if (d.bindingType === "for") {
          const p = engine.pattern(d.statePathName);
          const plan = compilePlan(engine, el as HTMLTemplateElement, p, true);
          const anchor = document.createComment("wcs-for");
          el.replaceWith(anchor);
          new ForView(engine, plan, listFor(engine, p, null, anchor), anchor).update();
        } else if (d.bindingType === "if") {
          const { parts, end } = readChain(engine, children, i, null);
          const branches = parts.map((part) => {
            const plan = compilePlan(engine, part.el, null, false);
            const anchor = document.createComment("wcs-if");
            part.el.replaceWith(anchor);
            return { plan, pattern: part.pattern, filters: part.filters, anchor };
          });
          attachChain(engine, branches, null, null);
          i = end;
        } else {
          notAfterIf(d.bindingType);
        }
        continue;
      }
      const text = el.getAttribute(bindAttr());
      if (text !== null && !bound.has(el)) {
        bound.add(el);
        for (const spec of elementSpecs(engine, text, null, el, 0)) attach(engine, spec, el);
      }
      if (hooks.componentScope === null || !hooks.componentScope(el)) walk(engine, Array.from(el.childNodes));
    } else if (child.nodeType === 3 && config.enableMustache && (child as Text).data.includes("{{")) {
      for (const { node, expr } of splitMustache(child as Text)) attach(engine, textSpec(engine, expr, null, 0), node);
    }
  }
}

function attach(engine: Engine, spec: Spec, node: Node): void {
  if (spec.kind === K_EVENT) {
    attachEvent(engine, node, spec, null);
    return;
  }
  const el = node as Element;
  switch (spec.kind) {
    case K_COMMAND:
      whenDefined(el, null, (bd) => attachCommand(engine, spec, el, null, bd));
      return;
    case K_EVTTOKEN:
      whenDefined(el, null, (bd) => attachEventToken(engine, spec, el, null, bd));
      return;
    case K_SPREAD:
      whenDefined(el, null, (bd) => attachSpread(engine, spec, el, null, null, bd));
      return;
  }
  const p = spec.pattern!;
  if (p.depth !== 0) raiseError(`[wcs/wildcard-rank] "${p.path}" needs ${p.depth} enclosing loop level(s); the scope provides 0.`);
  if (spec.custom && spec.kind === K_PROP) {
    whenDefined(el, null, (bd) => attachCustomOrPlain(engine, spec, el, null, null, bd));
    return;
  }
  const b = new Binding(engine, spec.kind, node, spec.name, p, null, null, spec.filters, spec.initial);
  b.inFilters = spec.inFilters;
  engine.register(b);
  engine.applyBinding(b);
  if (spec.twoWay !== null) node.addEventListener(spec.twoWay, () => b.writeBack());
}
