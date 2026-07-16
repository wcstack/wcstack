export interface ICustomElementRegistryAdapter {
  get(name: string): CustomElementConstructor | undefined;
  whenDefined(name: string): Promise<CustomElementConstructor>;
  upgrade?(root: Node): void;
}

export interface ICustomElementRegistryOwner {
  readonly customElements?: unknown;
}

/**
 * Resolve the registry at operation time so importing the runtime remains safe
 * when browser globals are absent. The owner hook is reserved for scoped
 * registries; current callers fall back to the global registry.
 */
export function getCustomElementRegistry(
  owner: ICustomElementRegistryOwner | null = null,
): ICustomElementRegistryAdapter | null {
  const globalRegistry = (globalThis as { readonly customElements?: unknown }).customElements;
  const registry = owner?.customElements ?? globalRegistry;
  if (typeof registry !== "object" || registry === null) return null;

  const candidate = registry as Partial<ICustomElementRegistryAdapter>;
  if (typeof candidate.get !== "function" || typeof candidate.whenDefined !== "function") {
    return null;
  }
  return candidate as ICustomElementRegistryAdapter;
}

export function upgradeCustomElement(
  registry: ICustomElementRegistryAdapter,
  root: Node,
): void {
  registry.upgrade?.(root);
}
