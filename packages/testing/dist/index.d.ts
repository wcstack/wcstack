/**
 * mount() — the README recipe ("Testing Your Page", @wcstack/state) as one call:
 * register the elements, insert the HTML, wait for every element and binding
 * under it, and hand back typed accessors for the page's `<wcs-state>`s.
 *
 * The wait is `@wcstack/server`'s `waitForReady` — the same stabilization loop
 * `renderToString` performs, so `<wcs-router>`'s first route, a `$connectedCallback`
 * that inserts more elements, and `<wcs-state>`'s binding construction are all
 * covered by the one call (docs/app-testing-and-typescript-impl-plan.md D11).
 */
type BootstrapFunction = () => void | Promise<void>;
interface MountOptions {
    /**
     * Where to insert the HTML. `"document"` (default) replaces `document.body`'s
     * content; `"shadow"` puts it inside an open ShadowRoot on a fresh host element
     * appended to `document.body` (bindings then scope to that root).
     */
    readonly root?: "document" | "shadow";
    /**
     * Element registrations to run before inserting the HTML. Default:
     * `[bootstrapState]` imported lazily from `@wcstack/state`. Add the packages
     * the page uses — `bootstrapRouter`, `bootstrapFetch`, … — as functions or
     * async loaders (`async () => (await import("@wcstack/router")).bootstrapRouter()`);
     * every wcstack bootstrap is idempotent, so calling them per test is safe.
     */
    readonly bootstrap?: readonly BootstrapFunction[];
    /** Tag name of the state element when `bootstrapState({ tagNames })` renamed it (default `wcs-state`). */
    readonly stateTagName?: string;
    /** Passed to `waitForReady` (default 10 stabilization rounds). */
    readonly maxIterations?: number;
}
interface StateHandle {
    /** The `<wcs-state>` element itself. */
    readonly element: HTMLElement;
    /** Read through a readonly proxy — the value `fn` returns is passed back. */
    read<T>(fn: (state: any) => T): T;
    /** Write through a writable proxy, exactly as a handler does. Follow with `await settle()`. */
    write(fn: (state: any) => void | Promise<void>): Promise<void>;
}
interface MountedApp {
    /** The root the HTML lives under: `document` or the ShadowRoot. Query it. */
    readonly root: Document | ShadowRoot;
    /** The node whose children are the mounted HTML: `document.body` or the shadow host. */
    readonly container: Element;
    /**
     * Accessor for the root `<wcs-state>` (v2: one state tree per root — volumes
     * (`mount=`) and `bind-component` elements are not it). Throws if absent.
     */
    state(): StateHandle;
    /** Remove the mounted HTML. */
    unmount(): void;
}
declare function mount(html: string, options?: MountOptions): Promise<MountedApp>;

/**
 * Let a state write reach the DOM.
 *
 * `@wcstack/state` applies updates on the microtask queue; two microtask turns
 * cover the write → apply chain, and one macrotask (`setTimeout(0)`) covers
 * anything a binding defers (e.g. a `customElements.whenDefined` re-apply).
 * This is exactly the wait the README recipe uses, fixed in one place.
 */
declare function settle(): Promise<void>;

/**
 * Dispatch a DOM event the way a user action would: bubbling by default, a
 * `CustomEvent` when `detail` is given, a plain `Event` otherwise.
 *
 * Returns what `dispatchEvent` returns (`false` when a handler called
 * `preventDefault()`). Follow with `await settle()` before asserting the DOM.
 */
declare function fire(target: EventTarget, type: string, init?: EventInit & {
    detail?: unknown;
}): boolean;

/**
 * Bare Node (no vitest `environment: 'happy-dom'`): create a happy-dom `Window`
 * and install its globals, using the same `installGlobals` `@wcstack/server` runs
 * for SSR. Returns an async restore function that also closes the window.
 *
 * Import order matters: `@wcstack/state`'s element classes pick their base class
 * when the module is evaluated, so `mount()` imports it lazily — after this
 * function has installed `HTMLElement`. Do the same for any other wcstack
 * package you bootstrap (`async () => (await import("@wcstack/router")).bootstrapRouter()`).
 *
 * `happy-dom` is an optional peer: it is only needed here. A `window` can also be
 * passed in (`installDom({ window })`) to skip the import entirely.
 */
interface InstallDomOptions {
    /** `window.location` for the page (default `http://localhost/`). */
    readonly url?: string;
    /** A ready-made happy-dom `Window`; when given, `happy-dom` is not imported. */
    readonly window?: unknown;
}
declare function installDom(options?: InstallDomOptions): Promise<() => Promise<void>>;

export { fire, installDom, mount, settle };
export type { BootstrapFunction, InstallDomOptions, MountOptions, MountedApp, StateHandle };
