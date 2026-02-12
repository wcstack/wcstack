
export function createEmptySet<T>(): Readonly<Set<T>> {
  return Object.freeze(new Set<T>());
}
