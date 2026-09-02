import { waitForReady, installGlobals } from '@wcstack/server';

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
let inlineScriptLoaderPatched = false;
/**
 * Route `<wcs-state>` inline `<script type="module">` through the `data:` URL
 * loader. Node cannot import `blob:` URLs, so the browser path (`URL.createObjectURL`)
 * would leave an inline-script state pending forever; the loader falls back to a
 * `data:` URL when `createObjectURL` is absent — the same switch `@wcstack/server`
 * flips for SSR. Applied once per process, only when a browser-style
 * `createObjectURL` is present (i.e. under vitest's happy-dom environment).
 */
function patchInlineScriptLoader() {
    if (inlineScriptLoaderPatched)
        return;
    inlineScriptLoaderPatched = true;
    if (typeof URL.createObjectURL === "function") {
        URL.createObjectURL = undefined;
    }
}
const TEXT_SETTER_PATCHED = Symbol.for("wcstack.testing.textSetterPatched");
/**
 * happy-dom's `textContent` setter treats a numeric `0` as empty (and `innerText`
 * throws on any non-string), whereas browsers stringify: `el.textContent = 0`
 * renders "0". A `textContent: count` binding assigns the raw number, so a count
 * that reaches zero would vanish only under happy-dom. Wrap the setters on every
 * prototype that owns one (Node, Element, HTMLElement) to coerce the way the
 * DOM spec does (`null` → "", anything else → `String(value)`). Idempotent per
 * prototype, so a fresh window from `installDom()` gets patched too.
 */
function patchTextSetters() {
    const targets = [
        [globalThis.Node, "textContent"],
        [globalThis.Element, "textContent"],
        [globalThis.HTMLElement, "textContent"],
        [globalThis.HTMLElement, "innerText"],
    ];
    for (const [ctor, property] of targets) {
        const proto = ctor?.prototype;
        if (proto === undefined)
            continue;
        const marker = `${String(TEXT_SETTER_PATCHED)}:${property}`;
        // own-property check: Element.prototype inherits Node.prototype's marker, and an
        // inherited marker must not make the Element setter (the one happy-dom uses) skip.
        if (Object.prototype.hasOwnProperty.call(proto, marker))
            continue;
        const descriptor = Object.getOwnPropertyDescriptor(proto, property);
        if (descriptor?.set === undefined)
            continue;
        const originalSet = descriptor.set;
        Object.defineProperty(proto, property, {
            ...descriptor,
            set(value) {
                originalSet.call(this, value === null || value === undefined ? "" : String(value));
            },
        });
        Object.defineProperty(proto, marker, { value: true, enumerable: false, configurable: true });
    }
}
async function defaultBootstraps() {
    // Lazy: the element classes bind their base class at module evaluation, which
    // must happen after the DOM globals exist (installDom() in bare Node).
    const { bootstrapState } = await import('@wcstack/state');
    return [bootstrapState];
}
async function mount(html, options = {}) {
    patchInlineScriptLoader();
    patchTextSetters();
    for (const bootstrap of options.bootstrap ?? (await defaultBootstraps())) {
        await bootstrap();
    }
    const stateTagName = options.stateTagName ?? "wcs-state";
    let root;
    let container;
    if (options.root === "shadow") {
        const host = document.createElement("div");
        host.setAttribute("data-wcs-testing-host", "");
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = html;
        document.body.appendChild(host);
        root = shadow;
        container = host;
    }
    else {
        document.body.innerHTML = html;
        root = document;
        container = document.body;
    }
    await waitForReady(root, { maxIterations: options.maxIterations });
    return {
        root,
        container,
        state(name = "default") {
            const element = [...root.querySelectorAll(stateTagName)]
                .find((el) => (el.getAttribute("name") ?? "default") === name);
            if (element === undefined) {
                throw new Error(`@wcstack/testing: no <${stateTagName}${name === "default" ? "" : ` name="${name}"`}> under the mounted root`);
            }
            return {
                element,
                read(fn) {
                    let out;
                    element.createState("readonly", (state) => {
                        out = fn(state);
                    });
                    return out;
                },
                async write(fn) {
                    await element.createStateAsync("writable", async (state) => {
                        await fn(state);
                    });
                },
            };
        },
        unmount() {
            if (root === document) {
                document.body.innerHTML = "";
            }
            else {
                container.remove();
            }
        },
    };
}

/**
 * Let a state write reach the DOM.
 *
 * `@wcstack/state` applies updates on the microtask queue; two microtask turns
 * cover the write → apply chain, and one macrotask (`setTimeout(0)`) covers
 * anything a binding defers (e.g. a `customElements.whenDefined` re-apply).
 * This is exactly the wait the README recipe uses, fixed in one place.
 */
async function settle() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Dispatch a DOM event the way a user action would: bubbling by default, a
 * `CustomEvent` when `detail` is given, a plain `Event` otherwise.
 *
 * Returns what `dispatchEvent` returns (`false` when a handler called
 * `preventDefault()`). Follow with `await settle()` before asserting the DOM.
 */
function fire(target, type, init = {}) {
    const { detail, ...eventInit } = init;
    const event = detail !== undefined
        ? new CustomEvent(type, { bubbles: true, ...eventInit, detail })
        : new Event(type, { bubbles: true, ...eventInit });
    return target.dispatchEvent(event);
}

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
async function installDom(options = {}) {
    const window = options.window ?? (await createWindow(options.url ?? "http://localhost/"));
    const restore = installGlobals(window);
    return async () => {
        restore();
        await window.happyDOM.close();
    };
}
async function createWindow(url) {
    let mod;
    try {
        mod = (await import('happy-dom'));
    }
    catch {
        throw new Error("@wcstack/testing: installDom() needs happy-dom (npm i -D happy-dom), or pass { window } — under vitest with environment: 'happy-dom' it is not needed at all");
    }
    return new mod.Window({ url });
}

export { fire, installDom, mount, settle };
//# sourceMappingURL=index.esm.js.map
