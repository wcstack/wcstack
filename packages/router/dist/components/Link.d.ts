import { Router } from "./Router";
import { ILink } from "./types";
export declare class Link extends HTMLElement implements ILink {
    static get observedAttributes(): string[];
    private _childNodeArray;
    private _uuid;
    private _path;
    private _router;
    private _anchorElement;
    private _initialized;
    private _onClick?;
    constructor();
    get uuid(): string;
    get router(): Router;
    private _initialize;
    private _normalizePathname;
    private _joinInternalPath;
    private _setAnchorHref;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    private _updateActiveState;
    get anchorElement(): HTMLAnchorElement | null;
}
//# sourceMappingURL=Link.d.ts.map