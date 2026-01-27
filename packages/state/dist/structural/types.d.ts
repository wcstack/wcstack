export interface IContent {
    readonly firstNode: Node | null;
    readonly lastNode: Node | null;
    mountAfter(targetNode: Node): void;
    unmount(): void;
}
//# sourceMappingURL=types.d.ts.map