/* v8 ignore start */
export {};

declare global {
  interface Set<T> {
    difference(other: Set<T>): Set<T>;
    intersection(other: Set<T>): Set<T>;
  }
}

if (!Set.prototype.difference) {
  Set.prototype.difference = function <T>(this: Set<T>, other: Set<T>): Set<T> {
    const result = new Set(this);
    for (const elem of other) {
      result.delete(elem);
    }
    return result;
  };
}

if (!Set.prototype.intersection) {
  Set.prototype.intersection = function <T>(this: Set<T>, other: Set<T>): Set<T> {
    const result = new Set<T>();
    for (const elem of other) {
      if (this.has(elem)) {
        result.add(elem);
      }
    }
    return result;
  };
}
