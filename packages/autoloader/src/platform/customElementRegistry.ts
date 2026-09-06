export interface ICustomElementRegistryAdapter {
  get(name: string): CustomElementConstructor | undefined;
  whenDefined(name: string): Promise<CustomElementConstructor>;
  define(
    name: string,
    constructor: CustomElementConstructor,
    options?: ElementDefinitionOptions,
  ): void;
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
  if (
    typeof candidate.get !== "function"
    || typeof candidate.whenDefined !== "function"
    || typeof candidate.define !== "function"
  ) {
    return null;
  }
  return candidate as ICustomElementRegistryAdapter;
}

/**
 * Resolve the registry that governs `root`.
 *
 * Scoped registries do not inherit from the global one, so defining a lazily
 * loaded tag globally leaves a scoped subtree's elements un-upgraded forever --
 * and the `whenDefined` used to chase their shadow content never resolves.
 * Autoloading therefore has to define into the registry the scanned root itself
 * resolves against. Roots on platforms without scoped registries report
 * `undefined` and fall back to the global registry.
 */
export function getCustomElementRegistry(
  root: Node | null = null,
): ICustomElementRegistryAdapter | null {
  if (root !== null && typeof root !== "undefined") {
    const scoped = (root as ICustomElementRegistryOwner).customElementRegistry;
    if (scoped === null) return null;
    if (typeof scoped !== "undefined") return toAdapter(scoped);
  }
  return toAdapter((globalThis as { readonly customElements?: unknown }).customElements);
}
