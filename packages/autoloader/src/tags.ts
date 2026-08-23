
export const failedTags = new Set<string>();

// The in-flight load per tag, so a second caller can await the load itself
// rather than the definition. A load that fails never defines its tag, so
// waiting on whenDefined() instead would wait forever.
export const loadingTags = new Map<string, Promise<void>>();

// Scoped registries each need their own define() call for the same tag, so an
// in-flight load in one registry must not make another registry skip its own.
// The module import itself is shared by the loader's own cache. The global
// registry keeps using the exported `loadingTags` so direct inspection works.
let loadingTagsByRegistry = new WeakMap<object, Map<string, Promise<void>>>();

export function getLoadingTags(registry: object): Map<string, Promise<void>> {
  if (registry === (globalThis as { readonly customElements?: unknown }).customElements) {
    return loadingTags;
  }
  let tags = loadingTagsByRegistry.get(registry);
  if (tags === undefined) {
    tags = new Map();
    loadingTagsByRegistry.set(registry, tags);
  }
  return tags;
}

export function resetState() {
  failedTags.clear();
  loadingTags.clear();
  loadingTagsByRegistry = new WeakMap();
}

