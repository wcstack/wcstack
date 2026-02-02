export {};
declare global {
    interface Set<T> {
        difference(other: Set<T>): Set<T>;
        intersection(other: Set<T>): Set<T>;
    }
}
//# sourceMappingURL=polyfills.d.ts.map