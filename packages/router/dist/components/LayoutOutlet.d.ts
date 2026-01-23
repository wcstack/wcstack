import { ILayout, ILayoutOutlet } from "./types.js";
export declare class LayoutOutlet extends HTMLElement implements ILayoutOutlet {
    private _layout;
    private _initialized;
    private _layoutChildNodes;
    constructor();
    get layout(): ILayout;
    set layout(value: ILayout);
    get name(): string;
    private _initialize;
    connectedCallback(): Promise<void>;
    assignParams(params: Record<string, any>): void;
}
export declare function createLayoutOutlet(): LayoutOutlet;
//# sourceMappingURL=LayoutOutlet.d.ts.map