import { ILayout } from "./types.js";
export declare class Layout extends HTMLElement implements ILayout {
    private _uuid;
    private _name;
    private _initialized;
    constructor();
    private _loadTemplateFromSource;
    private _loadTemplateFromDocument;
    loadTemplate(): Promise<HTMLTemplateElement>;
    get uuid(): string;
    get enableShadowRoot(): boolean;
    get name(): string;
    private _initialize;
    connectedCallback(): void;
}
//# sourceMappingURL=Layout.d.ts.map