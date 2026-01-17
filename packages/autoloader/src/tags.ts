
export const failedTags = new Set<string>();
export const loadingTags = new Set<string>();

export function resetState() {
  failedTags.clear();
  loadingTags.clear();
}

