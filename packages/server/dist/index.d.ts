import { Window } from 'happy-dom';

declare const GLOBALS_KEYS: string[];
declare function installGlobals(window: Window): () => void;
declare function installBaseUrl(baseUrl: string): () => void;
declare function extractStateData(stateEl: any): Record<string, any>;
interface RenderOptions {
    /** 相対 URL を解決するベース URL (例: "http://localhost:3001") */
    baseUrl?: string;
}
declare function renderToString(html: string, options?: RenderOptions): Promise<string>;

declare const VERSION: string;

interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    readonly version: number;
    readonly properties: IWcBindableProperty[];
}
/**
 * Value types for RenderCore (headless) — the 3 async state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new RenderCore();
 * bind(core, (name: keyof WcsRenderValues, value) => { ... });
 * ```
 */
interface WcsRenderValues {
    html: string | null;
    loading: boolean;
    error: Error | null;
}

declare class RenderCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _html;
    private _loading;
    private _error;
    get html(): string | null;
    get loading(): boolean;
    get error(): Error | null;
    private _setLoading;
    private _setHtml;
    private _setError;
    render(html: string): Promise<string | null>;
}

export { GLOBALS_KEYS, RenderCore, VERSION, extractStateData, installBaseUrl, installGlobals, renderToString };
export type { IWcBindable, IWcBindableProperty, RenderOptions, WcsRenderValues };
