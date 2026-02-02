if (!Set.prototype.difference) {
    Set.prototype.difference = function (other) {
        const result = new Set(this);
        for (const elem of other) {
            result.delete(elem);
        }
        return result;
    };
}
if (!Set.prototype.intersection) {
    Set.prototype.intersection = function (other) {
        const result = new Set();
        for (const elem of other) {
            if (this.has(elem)) {
                result.add(elem);
            }
        }
        return result;
    };
}
export {};
//# sourceMappingURL=polyfills.js.map