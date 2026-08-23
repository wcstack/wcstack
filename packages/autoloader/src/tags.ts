
export const failedTags = new Set<string>();
export const loadingTags = new Set<string>();

// Scoped registries each need their own define() call for the same tag, so an
// in-flight load in one registry must not make another registry skip its own.
// The module import itself is shared by the loader's own cache. The global
// registry keeps using the exported `loadingTags` so direct inspection works.
let loadingTagsByRegistry = new WeakMap<object, Set<string>>();

export function getLoadingTags(registry: object): Set<string> {
  if (registry === (globalThis as { readonly customElements?: unknown }).customElements) {
    return loadingTags;
  }
  let tags = loadingTagsByRegistry.get(registry);
  if (tags === undefined) {
    tags = new Set();
    loadingTagsByRegistry.set(registry, tags);
  }
  return tags;
}

export function resetState() {
  failedTags.clear();
  loadingTags.clear();
  loadingTagsByRegistry = new WeakMap();
}

