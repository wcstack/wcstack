import { AudioNodeKind } from "../types.js";
import { STRUCTURAL_ATTRIBUTES } from "../patch/compilePatch.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute } from "../protocol/inputAttribute.js";

let nextKey = 0;

/** The part of the root Shell a node needs, without importing it (cycle-free). */
export interface AudioRootLike extends HTMLElement {
  readonly isAudioRoot: true;
  readonly audioCore: {
    setParam(key: string, name: string, value: number): void;
    setProp(key: string, name: string, value: string | null): void;
    sample(key: string, mode?: "wave" | "fft"): Uint8Array | null;
  } | null;
  requestRebuild(): void;
}

/**
 * Nearest enclosing `<wcs-audio>`, hopping shadow hosts on the way up so a patch
 * split across component boundaries still finds its root. Identified by a
 * property rather than a tag name, since the tag name is configurable.
 */
export function findAudioRoot(start: Element): AudioRootLike | null {
  let node: Node | null = start.parentNode;
  while (node) {
    if ((node as AudioRootLike).isAudioRoot === true) return node as AudioRootLike;
    node = node.parentNode ?? (node as ShadowRoot).host ?? null;
  }
  return null;
}

/**
 * Base for every audio node tag.
 *
 * These elements are **descriptors and nothing else**. They hold a key, expose
 * their attributes as patch values, and forward live attribute changes to the
 * root's Core. They never hold an `AudioNode` — which is what makes ADR-14 G2
 * ("handles do not cross the protocol boundary") a structural property of the
 * package rather than a rule someone has to remember.
 *
 * It deliberately declares no `static wcBindable`: each concrete tag declares
 * its own inputs, and the base has no surface of its own.
 */
export class AudioNodeShell extends HTMLElement {
  /** Which builder the Core should use. Each concrete tag overrides it. */
  static kind: AudioNodeKind = "gain";

  /** Instance view of `static kind` — this is what the patch compiler reads. */
  get patchKind(): AudioNodeKind {
    return (this.constructor as typeof AudioNodeShell).kind;
  }

  /** AudioParam-backed attributes: name → default. */
  static params: Record<string, number> = {};
  /** Non-AudioParam attributes (`type`, `mix`, ADSR times, …). */
  static props: readonly string[] = [];

  static get observedAttributes(): string[] {
    return [...Object.keys(this.params), ...this.props, ...STRUCTURAL_ATTRIBUTES];
  }

  /** Stable identity for this element across rebuilds. */
  readonly patchKey = `n${++nextKey}`;

  patchParams(): Record<string, number> {
    const ctor = this.constructor as typeof AudioNodeShell;
    const params: Record<string, number> = {};
    for (const [name, dflt] of Object.entries(ctor.params)) params[name] = this._num(name, dflt);
    return params;
  }

  patchProps(): Record<string, string> {
    const ctor = this.constructor as typeof AudioNodeShell;
    const props: Record<string, string> = {};
    for (const name of ctor.props) {
      const value = this.getAttribute(name);
      if (value !== null) props[name] = value;
    }
    return props;
  }

  /** The attribute as a number, or the default when it is absent or not one.
   *  The property setters reflect to the attribute, so it is never stale. */
  protected _num(name: string, dflt: number): number {
    const raw = this.getAttribute(name);
    const n = raw === null ? NaN : parseFloat(raw);
    return Number.isFinite(n) ? n : dflt;
  }

  protected get root(): AudioRootLike | null {
    return findAudioRoot(this);
  }

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    this.root?.requestRebuild();
  }

  // No disconnectedCallback: by the time it runs `closest()` no longer reaches
  // the root. Removals are picked up by the root's MutationObserver, which sees
  // the childList mutation on its own subtree.

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    const ctor = this.constructor as typeof AudioNodeShell;
    // A numeric or setting change is applied live: straight to the Core, no rebuild.
    if (name in ctor.params) {
      const value = newValue === null ? ctor.params[name] : parseFloat(newValue);
      if (Number.isFinite(value)) this.root?.audioCore?.setParam(this.patchKey, name, value);
      return;
    }
    if (ctor.props.includes(name)) {
      // A removed attribute clears the setting: the Core puts its default back.
      this.root?.audioCore?.setProp(this.patchKey, name, newValue);
      return;
    }
    // Structural: the topology changed, so the graph has to be rebuilt.
    this.root?.requestRebuild();
  }
}

type Accessors = AudioNodeShell & {
  _num(name: string, dflt: number): number;
};

/**
 * Define accessors mirroring the node's attributes, so both `el.frequency = 900`
 * and `frequency="900"` reach the Core.
 *
 * A setter only reflects to its attribute (wc-bindable P3); attributeChangedCallback
 * carries the change to the Core. For an AudioParam that is a live `setParam`,
 * never a rebuild (the root observes childList only), so a parameter bound to a
 * slider at 60 fps costs one attribute write per frame on top of the same Core
 * call. `null` removes the attribute (the default), `undefined` restores the one
 * the element started with (P1); either way the sound follows.
 */
export function defineParamAccessors(ctor: typeof AudioNodeShell): void {
  for (const [name, dflt] of Object.entries(ctor.params)) {
    Object.defineProperty(ctor.prototype, name, {
      configurable: true,
      enumerable: true,
      get(this: Accessors) { return this._num(name, dflt); },
      // a string is written as it is and read as the attribute is (a binding hands over a range input's value as it is)
      set(this: AudioNodeShell, value: number | string | null | undefined) { reflectAttribute(this, name, value); },
    });
  }
  for (const name of ctor.props) {
    Object.defineProperty(ctor.prototype, name, {
      configurable: true,
      enumerable: true,
      get(this: AudioNodeShell) { return this.getAttribute(name) ?? ""; },
      set(this: AudioNodeShell, value: string | number | null | undefined) { reflectAttribute(this, name, value); },
    });
  }
}

/** wc-bindable `inputs` for a node tag, derived from its declared attributes. */
export function nodeInputs(ctor: typeof AudioNodeShell): { name: string; attribute: string }[] {
  return [
    ...Object.keys(ctor.params).map((name) => ({ name, attribute: name })),
    ...ctor.props.map((name) => ({ name, attribute: name })),
  ];
}
