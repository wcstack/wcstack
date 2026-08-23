export interface ICustomElementRegistryAdapter {
  get(name: string): CustomElementConstructor | undefined;
  whenDefined(name: string): Promise<CustomElementConstructor>;
  upgrade?(root: Node): void;
  define?(name: string, constructor: CustomElementConstructor): void;
}

export interface ICustomElementRegistryOwner {
  /**
   * Scoped registry hook, as exposed by `Element` / `Document` / `ShadowRoot`.
   * `undefined` on platforms without scoped custom element registries; `null`
   * when the node deliberately carries a null registry (a declarative shadow
   * root with `shadowrootcustomelementregistry`, or a document from
   * `createHTMLDocument()`) and has not been handed to `registry.initialize()`.
   */
  readonly customElementRegistry?: unknown;
  /** Legacy owner form: a `Window`-like object carrying a registry. */
  readonly customElements?: unknown;
}

function toAdapter(registry: unknown): ICustomElementRegistryAdapter | null {
  if (typeof registry !== "object" || registry === null) return null;

  const candidate = registry as Partial<ICustomElementRegistryAdapter>;
  if (typeof candidate.get !== "function" || typeof candidate.whenDefined !== "function") {
    return null;
  }
  return candidate as ICustomElementRegistryAdapter;
}

/**
 * Resolve the registry that governs `owner` at operation time, so importing the
 * runtime stays safe when browser globals are absent.
 *
 * Pass the node the operation is about (the bound element, its shadow root):
 * with scoped custom element registries the same tag name can resolve to a
 * different constructor per tree, so "is this tag defined?" is only meaningful
 * relative to a node. Nodes on platforms without scoped registries report
 * `undefined` and fall back to the global registry, which keeps every existing
 * caller on today's behaviour.
 */
export function getCustomElementRegistry(
  owner: ICustomElementRegistryOwner | Node | null = null,
): ICustomElementRegistryAdapter | null {
  if (owner !== null && typeof owner !== "undefined") {
    const { customElementRegistry: scoped, customElements: owned } =
      owner as ICustomElementRegistryOwner;
    // A node in a null-registry subtree resolves to no registry at all. Falling
    // back to the global one would report globally-defined tags as usable and
    // let us write own properties onto elements that are still un-upgraded --
    // exactly the accessor shadowing the deferred-apply path exists to avoid.
    if (scoped === null) return null;
    if (typeof scoped !== "undefined") return toAdapter(scoped);
    if (typeof owned !== "undefined") return toAdapter(owned);
  }
  return toAdapter((globalThis as { readonly customElements?: unknown }).customElements);
}

export function upgradeCustomElement(
  registry: ICustomElementRegistryAdapter,
  root: Node,
): void {
  registry.upgrade?.(root);
}
