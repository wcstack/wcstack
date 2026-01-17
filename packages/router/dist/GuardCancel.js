export class GuardCancel extends Error {
    fallbackPath;
    constructor(message, fallbackPath) {
        super(message);
        this.fallbackPath = fallbackPath;
    }
}
//# sourceMappingURL=GuardCancel.js.map