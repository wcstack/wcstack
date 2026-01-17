import { Router } from "./Router";
import { ILink } from "./types";
export declare class Link extends HTMLElement implements ILink {
    private _childNodeArray;
    private _uuid;
    private _commentNode;
    private _path;
    private _router;
    private _anchorElement;
    private _initialized;
    constructor();
    get uuid(): string;
    get commentNode(): Comment;
    get router(): Router;
    private _initialize;
    connectedCallback(): void;
    disconnectedCallback(): void;
    private _updateActiveState;
}
//# sourceMappingURL=Link.d.ts.map