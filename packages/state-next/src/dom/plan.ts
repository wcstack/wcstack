import { INDEX_PARAM, isThenable, type Engine } from "../engine";
import type { StateRow } from "../list";
import { UNSET, type Pattern } from "../pattern";
import { config } from "../config";
import { parseBindTextForEmbeddedNode, parseBindTextsForElement, type ParsedBinding } from "../parser/index";
import { buildFilters, type FilterFn } from "./filters";
import { raise, M } from "../messages";
import { hooks } from "../hooks";
import { isHtmlSink } from "../trustedTypes";
import {
  K_ATTR, K_CHECKBOX, K_CLASS, K_COMMAND, K_EVENT, K_EVTTOKEN, K_FOR, K_HTML, K_IF, K_PROP, K_RADIO, K_SPREAD, K_STYLE, K_TEXT, BUBBLING,
  isContent, type Branch, type BranchSpec, type RowPlan, type Spec,
} from "./view";

/** The binding attribute (`bindAttributeName`, default data-wcs). */
export const bindAttr = (): string => config.bindAttributeName;

/** `.label` / `.` inside a `for: data` template → `data.*.label` / `data.*`. */
export function expandPath(path: string, list: Pattern | null): string {
  if (path.charCodeAt(0) !== 46 /* . */) return path;
  if (list === null) raise(M.WildcardRelative, [path]);
  return path === "." ? `${list.path}.*` : `${list.path}.*${path}`;
}

function blank(): Spec {
  return {
    node: 0, kind: K_PROP, name: "", pattern: null, filters: null, initial: UNSET, listener: null, plan: null, branches: null,
    inFilters: null, twoWay: null, custom: false, init: null, sync: null, ro: false, prevent: false, stop: false, token: null, exclude: null,
    slot: -1, delegated: false,
  };
}

/** Native elements whose property flows back to state (custom elements come with wc-bindable). */
function isTwoWay(el: Element, prop: string): boolean {
  const tag = el.localName;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "button") return false;
    if ((type === "radio" || type === "checkbox") && prop === "checked") return true;
    return prop === "value" || prop === "valueAsNumber" || prop === "valueAsDate";
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

const INITS = ["state", "element", "auto", "none"];
const SYNCS = ["call", "connect"];

/** `#ro`, `#prevent`, `#stop`, `#onchange`, `#init=…`, `#sync=…`. */
function flags(engine: Engine, mods: string[]): Flags {
  const on = mods.find((m) => m.startsWith("on"));
  // (the keys are compared, never used as property names: the build renames `init` / `sync`)
  let init: string | null = null;
  let sync: string | null = null;
  for (const m of mods) {
    const i = m.indexOf("=");
    if (i < 0) continue;
    if (!engine.directional) raise(M.DirectionalSyncDisabled);
    const key = m.slice(0, i).trim();
    const value = m.slice(i + 1).trim();
    const isInit = key === "init";
    if (!isInit && key !== "sync") raise(M.ModifierUnknown, [key, m]);
    if ((isInit ? init : sync) !== null) raise(M.ModifierTwice, [key]);
    if (!(isInit ? INITS : SYNCS).includes(value)) raise(M.ModifierValue, [key, value]);
    if (isInit) init = value;
    else sync = value;
  }
  return {
    ro: mods.includes("ro"), prevent: mods.includes("prevent"), stop: mods.includes("stop"),
    event: on ? on.slice(2) : null, init, sync,
  };
}

const COMMAND_PREFIX = "$command.";

/** The pattern of a path a binding names (shown to the diagnostics add-on). */
export function boundPattern(engine: Engine, path: string, list: Pattern | null): Pattern {
  // `$1` is the loop index: a row pattern of the innermost loop answers it (Engine.markupAccessor)
  if (INDEX_PARAM.test(path)) {
    if (list === null) raise(M.WildcardNoLoop, [path, Number(path.slice(1))]);
    path = `${list.path}.*.${path}`;
  }
  const p = engine.pattern(expandPath(path, list));
  // each "*" is the row of the enclosing loop at its level, never a row of another list (F32)
  const d = list === null ? 0 : list.depth + 1;
  if (p.depth > d) raise(M.WildcardNoLoop, [p.path, p.depth, d]);
  for (let k = 1; k <= p.depth; k++) {
    const loop = k === d ? list! : list!.lists[k]!;
    if (p.lists[k] !== loop) raise(M.WildcardOtherList, [p.path, p.lists[k]!.path, loop.path]);
  }
  hooks.declared?.(engine, p);
  return p;
}

/** A binding that replaces its element with the value (`outerHTML:` / `outerText:`). */
export const isOuter = (name: string): boolean => name === "outerHTML" || name === "outerText";

/**
 * A binding after which the element's children are not markup to bind: it sets the element's content
 * (they are a value), or replaces the element (they are out of the page).
 */
export const setsContent = (s: Spec): boolean =>
  s.kind === K_HTML || isOuter(s.name) || (s.kind === K_PROP && isContent(s.name));

/** An `elseif:` / `else:` template with no `if:` before it. */
export function notAfterIf(type: string): never {
  raise(M.ElseWithoutIf, [type]);
}

export function specFor(engine: Engine, b: ParsedBinding, list: Pattern | null, el: Element, node: number): Spec {
  const f = flags(engine, b.propModifiers);
  const custom = el.localName.includes("-");
  const segs = b.propSegments;
  const path = b.statePathName;

  if (b.bindingType === "event") {
    if (f.init !== null && f.init !== "none") raise(M.EventInitNone);
    if (segs[0] === "eventToken") {
      return { ...blank(), node, kind: K_EVTTOKEN, name: segs.slice(1).join("."), token: path, custom, prevent: f.prevent, stop: f.stop };
    }
    // `onclick: $command.x` emits a command token; `onclick: method` calls a state method
    const command = path.startsWith(COMMAND_PREFIX) ? path.slice(COMMAND_PREFIX.length) : null;
    const { prevent, stop } = f;
    const type = b.propName.slice(2);
    // (a custom element's `change` / `click` may be dispatched without bubbling: see attachEvent)
    const delegated = BUBBLING.has(type);
    if (delegated) engine.delegate(type);
    return {
      ...blank(), node, kind: K_EVENT, name: type, delegated, custom,
      listener(e: Event, row: StateRow | null) {
        if (prevent) e.preventDefault();
        if (stop) e.stopPropagation();
        try {
          if (command !== null) engine.emitCommand(command, e, row);
          else {
            // an async handler's failure is reported like a sync one's (not left unhandled)
            const r = engine.invoke(path, e, row) as any;
            if (isThenable(r)) r.then(undefined, (error: unknown) => console.error(error));
          }
        } catch (error) {
          console.error(error);
        }
      },
    };
  }
  if (b.bindingType === "spread") {
    return { ...blank(), node, kind: K_SPREAD, pattern: boundPattern(engine, path, list), custom };
  }
  if (segs[0] === "command" && segs.length > 1) {
    if (!path.startsWith(COMMAND_PREFIX)) raise(M.CommandRightSide, [b.propName, path]);
    return { ...blank(), node, kind: K_COMMAND, name: segs.slice(1).join("."), token: path, custom };
  }

  const pattern = boundPattern(engine, path, list);
  const spec: Spec = {
    ...blank(), node, kind: K_PROP, name: b.propName, pattern,
    filters: buildFilters(b.outFilters), inFilters: buildFilters(b.inFilters), ro: f.ro, init: f.init, sync: f.sync,
  };
  if (b.bindingType === "radio" || b.bindingType === "checkbox") {
    if (f.init === "element" || f.init === "auto") raise(M.InitUnsupported, [b.bindingType, f.init]);
    spec.kind = b.bindingType === "radio" ? K_RADIO : K_CHECKBOX;
    if (!f.ro) spec.twoWay = f.event ?? "input";
    return spec;
  }
  if (segs.length > 1) {
    const name = segs.slice(1).join(".");
    const head = segs[0];
    if (head === "class" || head === "attr" || head === "style") {
      // a namespace takes no initial authority: #init= is ignored (as in 3.3)
      spec.init = null;
      spec.name = name;
      if (head === "class") {
        spec.kind = K_CLASS;
        spec.initial = el.classList.contains(name);
      } else {
        // (an iframe's srcdoc attribute is an HTML sink: written as the property, through the policy)
        spec.kind = head === "attr" ? (name === "srcdoc" && el.localName === "iframe" ? K_PROP : K_ATTR) : K_STYLE;
      }
      return spec;
    }
  }
  if (b.propName === "html") {
    spec.kind = K_HTML;
    return spec;
  }
  spec.name = b.propName === "text" ? "textContent" : b.propName;
  // an HTML sink is never a wc-bindable member: written at once, through the policy
  spec.custom = custom && !isHtmlSink(spec.name);
  if (!custom && !f.ro && isTwoWay(el, spec.name)) spec.twoWay = f.event ?? (el.localName === "select" ? "change" : "input");
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
  return { ...blank(), node, kind: K_TEXT, pattern: boundPattern(engine, b.statePathName, list), filters: buildFilters(b.outFilters), initial: "" };
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

/** The anchor text of a chain's `k`-th template: `if`, then `elseif`, and `else` (no path). */
export const chainAnchorText = (k: number, part: ChainPart): string =>
  k === 0 ? config.commentIfPrefix : part.pattern === null ? config.commentElsePrefix : config.commentElseIfPrefix;

/**
 * Reads an `if` chain starting at `first` (an `if:` template): the `elseif:` / `else:` templates
 * that follow it in the tree, across whitespace and comments. The walker skips the ones taken (each
 * is out of the tree, its anchor in its place).
 */
export function readChain(engine: Engine, first: Element, list: Pattern | null): ChainPart[] {
  const part = (el: Element, b: ParsedBinding): ChainPart => ({
    el: el as HTMLTemplateElement,
    pattern: b.bindingType === "else" ? null : boundPattern(engine, b.statePathName, list),
    filters: b.bindingType === "else" ? null : buildFilters(b.outFilters),
  });
  const parts = [part(first, directive(first)!)];
  for (let c = first.nextSibling; c !== null; c = c.nextSibling) {
    if ((c.nodeType === 3 && (c as Text).data.trim() === "") || c.nodeType === 8) continue;
    if (c.nodeType !== 1 || (c as Element).localName !== "template") break;
    const b = directive(c as Element);
    if (b === null || (b.bindingType !== "elseif" && b.bindingType !== "else")) break;
    parts.push(part(c as Element, b));
    if (b.bindingType === "else") break;
  }
  return parts;
}

/** The elements a page walk has visited: each is bound once, however often it is handed over. */
const walked = new WeakSet<Element>();

/**
 * Walks `children` and what they contain for bindings, by the same markup rules for the page
 * (`page`: the mount — it skips script / style, enters `<wcs-state>`, and marks anchors for SSR)
 * and for a template's content (a plan). Structural templates are compiled and replaced by
 * their anchors; the rest is handed to the callbacks.
 */
export function walkBindings(engine: Engine, children: ChildNode[], list: Pattern | null, page: boolean,
  onFor: (anchor: Comment, p: Pattern, plan: RowPlan) => void,
  onIf: (branches: Branch[]) => void,
  onElement: (el: Element, specs: Spec[]) => void,
  onText: (node: Text, expr: string) => void): void {
  // a structural template leaves the tree: its anchor takes its place
  const anchorFor = (el: Element, type: string): Comment => {
    const anchor = document.createComment(type);
    el.replaceWith(anchor);
    if (page) hooks.ssrMark?.(engine, anchor, el);
    return anchor;
  };
  const walk = (children: ChildNode[]): void => {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      // (out of the tree: an `elseif:` / `else:` template its chain's anchor replaced)
      if (child.parentNode === null) continue;
      if (child.nodeType === 1) {
        const el = child as Element;
        const tag = el.localName;
        if (page) {
          // walked before (a subtree handed over again): left alone — its text and rows show
          // values now, which are not markup
          if (tag === "script" || tag === "style" || walked.has(el)) continue;
          walked.add(el);
          // markup written inside a <wcs-state> is part of the page (its own attributes are not bindings)
          if (tag === config.tagNames.state) {
            walk(Array.from(el.childNodes));
            continue;
          }
        }
        // a template with no structural directive binds like any element (its content stays inert)
        const d = tag === "template" ? directive(el) : null;
        if (d !== null) {
          if (d.bindingType === "for") {
            const p = boundPattern(engine, d.statePathName, list);
            const plan = compilePlan(engine, el as HTMLTemplateElement, p, true);
            onFor(anchorFor(el, config.commentForPrefix), p, plan);
          } else if (d.bindingType === "if") {
            onIf(readChain(engine, el, list).map((part, k) => {
              const plan = compilePlan(engine, part.el, list, false);
              return { plan, pattern: part.pattern, filters: part.filters, anchor: anchorFor(part.el, chainAnchorText(k, part)) };
            }));
          } else {
            notAfterIf(d.bindingType);
          }
          continue;
        }
        const text = el.getAttribute(bindAttr());
        const specs = text === null ? null : elementSpecs(engine, text, list, el, 0);
        // What a binding puts in an element is a value, not markup. An element whose content a
        // binding sets (`textContent:` / `innerHTML:` / `html:`) is not walked at all — whenever the
        // value lands (a custom element's waits for its definition), and if it fails — nor one a
        // binding replaces (`outerHTML:` / `outerText:`: its children leave the page). Nor is the
        // content of a <noscript> or an <iframe>: raw text to a page that runs scripts (a server may
        // have rendered a value there). A Light DOM component's content is bound by its own engine
        const into = tag !== "noscript" && tag !== "iframe" && !specs?.some(setsContent) && !hooks.componentScope?.(el);
        // On the page an element's children are bound before it: what its bindings then put anywhere
        // in it (a custom element rendering a value into a child of its own) is never walked — nor
        // after an error in them, which leaves the walk with the element bound (it is before the
        // error in document order). A plan keeps document order (Block.dispatch relies on it): its
        // bindings change nothing in it
        try {
          if (page && into) walk(Array.from(el.childNodes));
        } finally {
          if (specs !== null) onElement(el, specs);
        }
        if (!page && into) walk(Array.from(el.childNodes));
      } else if (child.nodeType === 3 && engine.mustache && (child as Text).data.includes("{{")) {
        for (const { node, expr } of splitMustache(child as Text)) onText(node, expr);
      }
    }
  };
  walk(children);
}

/**
 * A template's content. A `<template>` inside `<svg>` is an SVG element (the HTML parser makes it
 * so) and has no `.content`: its children are its content (a copy of them: the template keeps them).
 */
export const templateContent = (t: HTMLTemplateElement): DocumentFragment => {
  const r = document.createRange();
  r.selectNodeContents(t);
  return t.content ?? r.cloneContents();
};

/**
 * Compiles a template into a plan: the fragment to clone, the child-index path of every
 * bound node, and one spec per binding. Paths are resolved to patterns here, once —
 * blocks never parse or resolve anything. `list` is the enclosing `for` (for `.` paths).
 */
export function compilePlan(engine: Engine, template: HTMLTemplateElement, list: Pattern | null, asRow: boolean): RowPlan {
  const frag = document.importNode(templateContent(template), true);
  const targets: Node[] = [];
  const specs: Spec[] = [];
  const target = (node: Node): number => targets.push(node) - 1;

  walkBindings(engine, Array.from(frag.childNodes), list, false,
    (anchor, p, plan) => {
      specs.push({ ...blank(), node: target(anchor), kind: K_FOR, pattern: p, plan });
    },
    (chain) => {
      const branches: BranchSpec[] = chain.map((br) => ({ node: target(br.anchor), plan: br.plan, pattern: br.pattern, filters: br.filters }));
      specs.push({ ...blank(), node: branches[0].node, kind: K_IF, branches });
    },
    (el, own) => {
      const n = target(el);
      for (const s of own) {
        // a row or a branch keeps its nodes by position: a binding that replaces its element (once —
        // the element is out of the page after) has no place in one
        if (isOuter(s.name)) raise(M.OuterInTemplate, [s.name]);
        s.node = n;
      }
      specs.push(...own);
      // the plan holds the bindings: blocks cloned from it carry nothing left to bind
      el.removeAttribute(bindAttr());
    },
    (node, expr) => {
      specs.push(textSpec(engine, expr, list, target(node)));
    });

  // Whitespace that never renders is not part of a block: at the top level, and inside
  // elements whose content model has no text (table parts, select). Bound text nodes start
  // empty: keep them.
  stripInsignificantWhitespace(frag, new Set(targets), true);

  const nodePaths = targets.map((t) => pathOf(frag, t));
  // one node cloned alone — not a structural anchor, whose view inserts before it (it needs a parent)
  const single = frag.childNodes.length === 1 && frag.firstChild!.nodeType !== 8;
  const nested = specs.some((s) => s.kind === K_FOR || s.kind === K_IF);
  const lazy: Spec[] = [];
  const used = new Set<number>();
  const events: Spec[] = [];
  // what a block binds as it is built (the delegated events it finds by path are not among them)
  const own: Spec[] = [];
  // in a row plan, the row's own locations bound by kinds that need only the node are slots (see RowView)
  const d = asRow ? list!.depth + 1 : -1;
  for (const s of specs) {
    // a node used only by delegated events is never resolved when a block is built (a custom
    // element's are attached: it may dispatch them without bubbling)
    if (s.kind === K_EVENT && s.delegated && !s.custom && !shifts(targets[s.node], frag)) {
      events.push(s);
      continue;
    }
    own.push(s);
    const p = s.pattern;
    if (p !== null && p.depth === d && p.lists[d] === list && isSlotKind(s)) s.slot = lazy.push(s) - 1;
    if (s.kind === K_IF) for (const br of s.branches!) used.add(br.node);
    else used.add(s.node);
  }
  const build = [...used].sort((a, b) => a - b);
  return { fragment: frag, root: single ? frag.firstChild : null, nodePaths, build, events, specs: own, single, nested, scratch: [], lazy };
}

/**
 * Whether the path to `n` from its block's top node can change once the block renders: a
 * structural anchor before it on the way (its view renders before the anchor) or a custom element
 * above it (a Light DOM component may add children). Such an element's delegated events are not
 * found by path: they are stored on the element as its block is built.
 */
function shifts(n: Node, top: Node): boolean {
  for (; n.parentNode !== top; n = n.parentNode!) {
    if ((n.parentNode as Element).localName.includes("-")) return true;
    for (let s = n.previousSibling; s; s = s.previousSibling) if (s.nodeType === 8) return true;
  }
  return false;
}

function isSlotKind(s: Spec): boolean {
  // a slot applies its first value as it is built: #init= needs a Binding (HOLD)
  if (s.init !== null) return false;
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
