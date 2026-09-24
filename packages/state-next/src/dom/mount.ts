import type { Engine } from "../engine";
import { config } from "../config";
import { bindAttr, compilePlan, directive, elementSpecs, readChain, splitMustache, textSpec } from "./plan";
import { attachChain, attachCustomOrPlain, attachEvent, Binding, ForView, K_COMMAND, K_EVENT, K_EVTTOKEN, K_PROP, K_SPREAD, type Spec } from "./view";
import { attachCommand, attachEventToken, attachSpread, whenDefined } from "./wc";

/** Binds everything under `root` (outside <wcs-state>) to `engine` and renders it. */
export function mount(engine: Engine, root: Document | ShadowRoot | Element): void {
  const container: Node = root.nodeType === 9 ? (root as Document).body : root;
  engine.root = root;
  walk(engine, container);
  engine.report();
}

function walk(engine: Engine, parent: Node): void {
  const children = Array.from(parent.childNodes);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1) {
      const el = child as Element;
      const tag = el.localName;
      if (tag === config.tagNames.state || tag === "script" || tag === "style") continue;
      if (tag === "template") {
        const d = directive(el);
        if (d === null) continue;
        if (d.bindingType === "for") {
          const p = engine.pattern(d.statePathName);
          const plan = compilePlan(engine, el as HTMLTemplateElement, p, true);
          const anchor = document.createComment("wcs-for");
          el.replaceWith(anchor);
          new ForView(engine, plan, engine.rootList(p), anchor).update();
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
          throw new Error(`[state-next] "${d.bindingType}:" must follow an "if:" template`);
        }
        continue;
      }
      const text = el.getAttribute(bindAttr());
      if (text !== null) {
        for (const spec of elementSpecs(engine, text, null, el, 0)) attach(engine, spec, el);
      }
      walk(engine, el);
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
  if (p.depth !== 0) throw new Error(`[state-next] "${p.path}" needs a row, outside any for template`);
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
