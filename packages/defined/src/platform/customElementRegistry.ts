export interface ICustomElementRegistryAdapter {
  get(name: string): CustomElementConstructor | undefined;
  whenDefined(name: string): Promise<CustomElementConstructor>;
}

interface ICustomElementRegistryOwner {
  /**
   * Scoped registry hook, as exposed by `Element` / `Document` / `ShadowRoot`.
   * `undefined` on platforms without scoped custom element registries; `null`
   * when the node deliberately carries a null registry and has not been handed
   * to `registry.initialize()`.
   */
  readonly customElementRegistry?: unknown;
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
 * Resolve the registry that governs `owner`.
 *
 * With scoped custom element registries a tag name only means something
 * relative to a tree, so the gate has to watch the registry its own subtree
 * resolves against -- watching the global one would report a tag as defined
 * that nothing in this tree can ever use. Nodes on platforms without scoped
 * registries report `undefined` and fall back to the global registry.
 */
export function getCustomElementRegistry(
  owner: Node | null = null,
): ICustomElementRegistryAdapter | null {
  if (owner !== null && typeof owner !== "undefined") {
    const scoped = (owner as ICustomElementRegistryOwner).customElementRegistry;
    if (scoped === null) return null;
    if (typeof scoped !== "undefined") return toAdapter(scoped);
  }
  return toAdapter((globalThis as { readonly customElements?: unknown }).customElements);
}
