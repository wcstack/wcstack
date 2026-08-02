import { AudioNodeKind, Patch, PatchNode, PatchVoice } from "../types.js";

/**
 * What the DOM walker needs from an element to describe it, without importing
 * the Shell classes (which would make this module part of a cycle).
 */
export interface PatchSource extends Element {
  readonly patchKind: AudioNodeKind;
  readonly patchKey: string;
  patchParams(): Record<string, number>;
  patchProps(): Record<string, string>;
}

const isPatchSource = (el: Element): el is PatchSource =>
  typeof (el as PatchSource).patchKind === "string";

const isVoice = (el: Element): boolean =>
  (el as { isAudioVoice?: boolean }).isAudioVoice === true;

const isRoot = (el: Element): boolean =>
  (el as { isAudioRoot?: boolean }).isAudioRoot === true;

/**
 * Direct graph children of `host`: descend through ordinary HTML (a `<div>`, a
 * `<label>`, whatever the page's layout needs) but stop at audio elements so
 * they can nest their own chains, and at a nested root so its patch stays its
 * own.
 *
 * This is what lets a patch be written inline among the controls that drive it
 * rather than in a separate, markup-shaped island.
 */
export function graphChildren(host: Element): Element[] {
  const found: Element[] = [];
  const scan = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (isPatchSource(child) || isVoice(child)) found.push(child);
      else if (!isRoot(child)) scan(child);
    }
  };
  scan(host);
  return found;
}

const splitRefs = (value: string | null): string[] | undefined => {
  if (value === null) return undefined;
  const refs = value.trim().split(/\s+/).filter((r) => r !== "");
  return refs.length > 0 ? refs : undefined;
};

function describe(el: PatchSource): PatchNode {
  const node: {
    -readonly [K in keyof PatchNode]: PatchNode[K];
  } = {
    kind: el.patchKind,
    key: el.patchKey,
  };
  const id = el.getAttribute("id");
  if (id !== null && id !== "") node.id = id;
  const params = el.patchParams();
  if (Object.keys(params).length > 0) node.params = params;
  const props = el.patchProps();
  if (Object.keys(props).length > 0) node.props = props;
  const out = splitRefs(el.getAttribute("out"));
  if (out) node.out = out;
  const param = el.getAttribute("param");
  if (param !== null && param !== "") node.param = param;
  if (el.hasAttribute("note")) node.note = true;
  if (el.hasAttribute("master")) node.master = true;

  const children: PatchNode[] = [];
  for (const child of graphChildren(el)) {
    // graphChildren only yields voices and patch sources, so anything that is
    // not a voice is describable. A voice can only be a template at the top
    // level of a patch: nesting one inside a chain has no meaning (which graph
    // would it instantiate into?).
    if (!isVoice(child)) children.push(describe(child as PatchSource));
  }
  if (children.length > 0) node.children = children;
  return node as PatchNode;
}

/**
 * Walk the DOM below `root` and produce the patch describing it.
 *
 * The DOM is one authoring surface for a patch, not the patch itself: the
 * descriptor this returns is the thing the Core consumes, and it can equally be
 * written by hand (ADR-14 G1).
 */
export function compilePatch(root: Element): Patch {
  const nodes: PatchNode[] = [];
  const voices: PatchVoice[] = [];
  for (const child of graphChildren(root)) {
    if (isVoice(child)) {
      const el = child as Element & { patchKey: string; poly: number };
      voices.push({
        key: el.patchKey,
        poly: el.poly,
        nodes: graphChildren(child).filter(isPatchSource).map(describe),
      });
    } else {
      nodes.push(describe(child as PatchSource));
    }
  }
  return { nodes, voices };
}

/**
 * Attributes whose change alters topology rather than a value. Everything else
 * is a live update — see docs/audio-tag-design.md §5.
 */
export const STRUCTURAL_ATTRIBUTES = ["id", "out", "param", "note", "master", "poly"] as const;
