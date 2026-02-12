
export function createEmptyArray<T>(): Readonly<Array<T>> {
  return Object.freeze<Array<T>>([]);
}
