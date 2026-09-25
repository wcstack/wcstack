import type { Engine } from "../engine";
import type { StateRow } from "../list";
import { UNSET, type Pattern } from "../pattern";
import { config } from "../config";
import { parseBindTextForEmbeddedNode, parseBindTextsForElement, type ParsedBinding } from "../parser/index";
import { buildFilters, type FilterFn } from "./filters";
import { raiseError } from "../parser/raiseError";
import {
  K_ATTR, K_CHECKBOX, K_CLASS, K_COMMAND, K_EVENT, K_EVTTOKEN, K_FOR, K_HTML, K_IF, K_PROP, K_RADIO, K_SPREAD, K_STYLE, K_TEXT, BUBBLING,
  type BranchSpec, type RowPlan, type Spec,
} from "./view";

/** The binding attribute (`bindAttributeName`, default data-wcs). */
export const bindAttr = (): string => config.bindAttributeName;

/** `.label` / `.` inside a `for: data` template → `data.*.label` / `data.*`. */
export function expandPath(path: string, list: Pattern | null): string {
  if (path.charCodeAt(0) !== 46 /* . */) return path;
  if (list === null) raiseError(`[wcs/wildcard-rank] "${path}" is relative: it needs an enclosing "for" template`);
  return path === "." ? `${list.path}.*` : `${list.path}.*${path}`;
}

function blank(): Spec {
  return {
    node: 0, kind: K_PROP, name: "", pattern: null, filters: null, initial: UNSET, listener: null, plan: null, branches: null,
    inFilters: null, twoWay: null, custom: false, init: null, sync: null, ro: false, prevent: false, stop: false, token: null, exclude: null,
    slot: -1, delegated: false,
  };
}

const CHECK_TYPES = new Set(["radio", "checkbox"]);
const VALUE_PROPS = new Set(["value", "valueAsNumber", "valueAsDate"]);

/** Native elements whose property flows back to state (custom elements come with wc-bindable). */
function isTwoWay(el: Element | null, prop: string): boolean {
  if (el === null) return false;
  const tag = el.localName;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "button") return false;
    if (CHECK_TYPES.has(type) && prop === "checked") return true;
    return VALUE_PROPS.has(prop);
  }
  return (tag === "select" || tag === "textarea") && prop === "value";
}

interface Flags {
  ro: boolean;
  prevent: boolean;
  stop: boolean;
  /** `#onchange` → "change": the event that writes back instead of the default. */
  event: string | null;
  init: string | null;
  sync: string | null;
}

/** `#ro`, `#prevent`, `#stop`, `#onchange`, `#init=…`, `#sync=…`. */
function flags(mods: string[]): Flags {
  const on = mods.find((m) => m.startsWith("on"));
  const value = (key: string): string | null => mods.find((m) => m.startsWith(key + "="))?.slice(key.length + 1) ?? null;
  return {
    ro: mods.includes("ro"), prevent: mods.includes("prevent"), stop: mods.includes("stop"),
    event: on ? on.slice(2) : null, init: value("init"), sync: value("sync"),
  };
}

const COMMAND_PREFIX = "$command.";

/** An `elseif:` / `else:` template with no `if:` before it. */
export function notAfterIf(type: string): never {
  raiseError(`[wcs/template-syntax] "${type}:" must follow an "if:" template`);
}

export function specFor(engine: Engine, b: ParsedBinding, list: Pattern | null, el: Element | null, node: number): Spec {
  const f = flags(b.propModifiers);
  const custom = el !== null && el.localName.includes("-");
  const segs = b.propSegments;
  const path = b.statePathName;

  if (b.bindingType === "event") {
    if (segs[0] === "eventToken") {
      return { ...blank(), node, kind: K_EVTTOKEN, name: segs.slice(1).join("."), token: path, custom, prevent: f.prevent, stop: f.stop };
    }
    // `onclick: $command.x` emits a command token; `onclick: method` calls a state method
    const command = path.startsWith(COMMAND_PREFIX) ? path.slice(COMMAND_PREFIX.length) : null;
    const { prevent, stop } = f;
    const type = b.propName.slice(2);
    const delegated = BUBBLING.has(type);
    if (delegated) engine.delegate(type);
    return {
      ...blank(), node, kind: K_EVENT, name: type, delegated,
      listener(e: Event, row: StateRow | null) {
        if (prevent) e.preventDefault();
        if (stop) e.stopPropagation();
        try {
          if (command !== null) engine.emitCommand(command, e, row);
          else engine.invoke(path, e, row);
        } catch (error) {
          console.error(error);
        }
      },
    };
  }
  if (b.bindingType === "spread") {
    return { ...blank(), node, kind: K_SPREAD, pattern: engine.pattern(expandPath(path, list)), custom };
  }
  if (segs[0] === "command" && segs.length > 1) {
    if (!path.startsWith(COMMAND_PREFIX)) raiseError(`[wcs/token-misconfigured] "${b.propName}: ${path}": the right-hand side must be $command.<name>`);
    return { ...blank(), node, kind: K_COMMAND, name: segs.slice(1).join("."), token: path.slice(COMMAND_PREFIX.length), custom };
  }

  const pattern = engine.pattern(expandPath(path, list));
  const spec: Spec = {
    ...blank(), node, kind: K_PROP, name: b.propName, pattern,
    filters: buildFilters(b.outFilters), inFilters: buildFilters(b.inFilters), ro: f.ro, init: f.init, sync: f.sync,
  };
  if (b.bindingType === "radio" || b.bindingType === "checkbox") {
    spec.kind = b.bindingType === "radio" ? K_RADIO : K_CHECKBOX;
    if (!f.ro) spec.twoWay = f.event ?? "input";
    return spec;
  }
  if (segs.length > 1) {
    const name = segs.slice(1).join(".");
    const head = segs[0];
    if (head === "class") {
      spec.kind = K_CLASS;
      spec.name = name;
      spec.initial = el !== null && el.classList.contains(name);
      return spec;
    }
    if (head === "attr" || head === "style") {
      spec.kind = head === "attr" ? K_ATTR : K_STYLE;
      spec.name = name;
      return spec;
    }
  }
  if (b.propName === "html") {
    spec.kind = K_HTML;
    return spec;
  }
  spec.name = b.propName === "text" ? "textContent" : b.propName;
  spec.custom = custom;
  if (!custom && !f.ro && isTwoWay(el, spec.name)) spec.twoWay = f.event ?? (el!.localName === "select" ? "change" : "input");
  return spec;
}

/**
 * The specs of one element's data-wcs, in order. A spread is told which members are bound
 * explicitly after it (last wins).
 */
export function elementSpecs(engine: Engine, text: string, list: Pattern | null, el: Element, node: number): Spec[] {
  const specs = parseBindTextsForElement(text).map((b) => specFor(engine, b, list, el, node));
  for (let i = 0; i < specs.length; i++) {
    if (specs[i].kind !== K_SPREAD) continue;
    specs[i].exclude = specs.slice(i + 1).filter((s) => s.kind === K_PROP).map((s) => s.name);
  }
  return specs;
}

const MUSTACHE = /\{\{([\s\S]+?)\}\}/g;

/** Replaces a text node holding `{{ … }}` with static text nodes and empty bound ones. */
export function splitMustache(t: Text): { node: Text; expr: string }[] {
  const s = t.data;
  const out: { node: Text; expr: string }[] = [];
  const parent = t.parentNode!;
  const doc = t.ownerDocument;
  let last = 0;
  MUSTACHE.lastIndex = 0;
  for (let m = MUSTACHE.exec(s); m !== null; m = MUSTACHE.exec(s)) {
    if (m.index > last) parent.insertBefore(doc.createTextNode(s.slice(last, m.index)), t);
    const bound = doc.createTextNode("");
    parent.insertBefore(bound, t);
    out.push({ node: bound, expr: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (out.length === 0) return out;
  if (last < s.length) parent.insertBefore(doc.createTextNode(s.slice(last)), t);
  parent.removeChild(t);
  return out;
}

export function textSpec(engine: Engine, expr: string, list: Pattern | null, node: number): Spec {
  const b = parseBindTextForEmbeddedNode(expr);
  return { ...blank(), node, kind: K_TEXT, pattern: engine.pattern(expandPath(b.statePathName, list)), filters: buildFilters(b.outFilters), initial: "" };
}

/** The structural directive on a template (`for` / `if` / `elseif` / `else`), or null. */
export function directive(el: Element): ParsedBinding | null {
  const text = el.getAttribute(bindAttr());
  if (text === null) return null;
  const b = parseBindTextsForElement(text)[0];
  return b !== undefined && (b.bindingType === "for" || b.bindingType === "if" || b.bindingType === "elseif" || b.bindingType === "else") ? b : null;
}

export interface ChainPart {
  el: HTMLTemplateElement;
  pattern: Pattern | null;
  filters: FilterFn[] | null;
}

/**
 * Reads an `if` chain starting at children[start] (an `if:` template): the `elseif:` /
 * `else:` templates that follow it, across whitespace and comments. Returns the parts and
 * the index of the last child consumed.
 */
export function readChain(engine: Engine, children: ChildNode[], start: number, list: Pattern | null): { parts: ChainPart[]; end: number } {
  const part = (el: Element, b: ParsedBinding): ChainPart => ({
    el: el as HTMLTemplateElement,
    pattern: b.bindingType === "else" ? null : engine.pattern(expandPath(b.statePathName, list)),
    filters: b.bindingType === "else" ? null : buildFilters(b.outFilters),
  });
  const first = children[start] as Element;
  const parts = [part(first, directive(first)!)];
  let end = start;
  for (let i = start + 1; i < children.length; i++) {
    const c = children[i];
    if (c.nodeType === 3 && (c as Text).data.trim() === "") continue;
    if (c.nodeType === 8) continue;
    if (c.nodeType !== 1 || (c as Element).localName !== "template") break;
    const b = directive(c as Element);
    if (b === null || (b.bindingType !== "elseif" && b.bindingType !== "else")) break;
    parts.push(part(c as Element, b));
    end = i;
    if (b.bindingType === "else") break;
  }
  return { parts, end };
}

/**
 * Compiles a template into a plan: the fragment to clone, the child-index path of every
 * bound node, and one spec per binding. Paths are resolved to patterns here, once —
 * blocks never parse or resolve anything. `list` is the enclosing `for` (for `.` paths).
 */
export function compilePlan(engine: Engine, template: HTMLTemplateElement, list: Pattern | null, asRow: boolean): RowPlan {
  const frag = document.importNode(template.content, true);
  const targets: Node[] = [];
  const specs: Spec[] = [];
  const target = (node: Node): number => targets.push(node) - 1;

  const walk = (parent: Node): void => {
    const children = Array.from(parent.childNodes);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType === 1) {
        const el = child as Element;
        if (el.localName === "template") {
          const d = directive(el);
          if (d === null) continue;
          if (d.bindingType === "for") {
            const p = engine.pattern(expandPath(d.statePathName, list));
            const sub = compilePlan(engine, el as HTMLTemplateElement, p, true);
            const anchor = document.createComment("wcs-for");
            el.replaceWith(anchor);
            specs.push({ ...blank(), node: target(anchor), kind: K_FOR, pattern: p, plan: sub });
          } else if (d.bindingType === "if") {
            const { parts, end } = readChain(engine, children, i, list);
            const branches: BranchSpec[] = parts.map((part) => {
              const branchPlan = compilePlan(engine, part.el, list, false);
              const anchor = document.createComment("wcs-if");
              part.el.replaceWith(anchor);
              return { node: target(anchor), plan: branchPlan, pattern: part.pattern, filters: part.filters };
            });
            specs.push({ ...blank(), node: branches[0].node, kind: K_IF, branches });
            i = end;
          } else {
            notAfterIf(d.bindingType);
          }
          continue;
        }
        const text = el.getAttribute(bindAttr());
        if (text !== null) {
          specs.push(...elementSpecs(engine, text, list, el, target(el)));
          // the plan holds the bindings: blocks cloned from it carry nothing left to bind
          el.removeAttribute(bindAttr());
        }
        walk(el);
      } else if (child.nodeType === 3 && config.enableMustache && (child as Text).data.includes("{{")) {
        for (const { node, expr } of splitMustache(child as Text)) specs.push(textSpec(engine, expr, list, target(node)));
      }
    }
  };
  walk(frag);

  // Whitespace that never renders is not part of a block: at the top level, and inside
  // elements whose content model has no text (table parts, select). Bound text nodes start
  // empty: keep them.
  stripInsignificantWhitespace(frag, new Set(targets), true);

  const nodePaths = targets.map((t) => pathOf(frag, t));
  const single = frag.childNodes.length === 1;
  const nested = specs.some((s) => s.kind === K_FOR || s.kind === K_IF);
  const lazy: Spec[] = [];
  if (asRow) {
    // the row's own locations, bound by kinds that need only the node: slots (see RowView)
    const d = list!.depth + 1;
    for (const s of specs) {
      const p = s.pattern;
      if (p !== null && p.depth === d && p.lists[d] === list && isSlotKind(s)) s.slot = lazy.push(s) - 1;
    }
  }
  // a node used only by delegated events is never resolved when a block is built
  const used = new Set<number>();
  const events: Spec[] = [];
  for (const s of specs) {
    if (s.kind === K_EVENT && s.delegated) events.push(s);
    else if (s.kind === K_IF) for (const br of s.branches!) used.add(br.node);
    else used.add(s.node);
  }
  const build = [...used].sort((a, b) => a - b);
  return { fragment: frag, root: single ? frag.firstChild : null, nodePaths, build, events, specs, single, nested, scratch: [], lazy };
}

function isSlotKind(s: Spec): boolean {
  switch (s.kind) {
    case K_TEXT:
    case K_CLASS:
    case K_ATTR:
    case K_STYLE:
    case K_HTML:
      return true;
    case K_PROP:
      return !s.custom && s.twoWay === null;
    default:
      return false;
  }
}

/** Elements whose children never render as text: whitespace between their children is noise. */
const NO_TEXT = new Set(["table", "thead", "tbody", "tfoot", "tr", "colgroup", "select", "optgroup", "datalist"]);

function stripInsignificantWhitespace(parent: Node, keep: Set<Node>, strip: boolean): void {
  for (let n = parent.firstChild; n !== null;) {
    const next = n.nextSibling;
    if (n.nodeType === 3) {
      if (strip && !keep.has(n) && (n as Text).data.trim() === "") parent.removeChild(n);
    } else if (n.nodeType === 1) {
      stripInsignificantWhitespace(n, keep, NO_TEXT.has((n as Element).localName));
    }
    n = next;
  }
}

function pathOf(root: Node, node: Node): number[] {
  const path: number[] = [];
  for (let n: Node = node; n !== root; n = n.parentNode!) {
    let i = 0;
    for (let s = n.previousSibling; s !== null; s = s.previousSibling) i++;
    path.unshift(i);
  }
  return path;
}
