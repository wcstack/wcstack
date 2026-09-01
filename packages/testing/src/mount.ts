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

import { waitForReady } from "@wcstack/server";

export type BootstrapFunction = () => void | Promise<void>;

export interface MountOptions {
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

export interface StateHandle {
  /** The `<wcs-state>` element itself. */
  readonly element: HTMLElement;
  /** Read through a readonly proxy — the value `fn` returns is passed back. */
  read<T>(fn: (state: any) => T): T;
  /** Write through a writable proxy, exactly as a handler does. Follow with `await settle()`. */
  write(fn: (state: any) => void | Promise<void>): Promise<void>;
}

export interface MountedApp {
  /** The root the HTML lives under: `document` or the ShadowRoot. Query it. */
  readonly root: Document | ShadowRoot;
  /** The node whose children are the mounted HTML: `document.body` or the shadow host. */
  readonly container: Element;
  /** Accessor for the `<wcs-state>` named `name` (default `"default"`, i.e. no `name` attribute). Throws if absent. */
  state(name?: string): StateHandle;
  /** Remove the mounted HTML. */
  unmount(): void;
}

interface StateElementLike extends HTMLElement {
  createState(mutability: "readonly" | "writable", callback: (state: any) => void): void;
  createStateAsync(mutability: "readonly" | "writable", callback: (state: any) => Promise<void>): Promise<void>;
}

let inlineScriptLoaderPatched = false;

/**
 * Route `<wcs-state>` inline `<script type="module">` through the `data:` URL
 * loader. Node cannot import `blob:` URLs, so the browser path (`URL.createObjectURL`)
 * would leave an inline-script state pending forever; the loader falls back to a
 * `data:` URL when `createObjectURL` is absent — the same switch `@wcstack/server`
 * flips for SSR. Applied once per process, only when a browser-style
 * `createObjectURL` is present (i.e. under vitest's happy-dom environment).
 */
function patchInlineScriptLoader(): void {
  if (inlineScriptLoaderPatched) return;
  inlineScriptLoaderPatched = true;
  if (typeof URL.createObjectURL === "function") {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = undefined;
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
function patchTextSetters(): void {
  const targets: Array<[unknown, string]> = [
    [globalThis.Node, "textContent"],
    [globalThis.Element, "textContent"],
    [globalThis.HTMLElement, "textContent"],
    [globalThis.HTMLElement, "innerText"],
  ];
  for (const [ctor, property] of targets) {
    const proto = (ctor as { prototype?: object } | undefined)?.prototype as (Record<symbol, unknown> & object) | undefined;
    if (proto === undefined) continue;
    const marker = `${String(TEXT_SETTER_PATCHED)}:${property}`;
    // own-property check: Element.prototype inherits Node.prototype's marker, and an
    // inherited marker must not make the Element setter (the one happy-dom uses) skip.
    if (Object.prototype.hasOwnProperty.call(proto, marker)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (descriptor?.set === undefined) continue;
    const originalSet = descriptor.set;
    Object.defineProperty(proto, property, {
      ...descriptor,
      set(this: unknown, value: unknown) {
        originalSet.call(this, value === null || value === undefined ? "" : String(value));
      },
    });
    Object.defineProperty(proto, marker, { value: true, enumerable: false, configurable: true });
  }
}

async function defaultBootstraps(): Promise<readonly BootstrapFunction[]> {
  // Lazy: the element classes bind their base class at module evaluation, which
  // must happen after the DOM globals exist (installDom() in bare Node).
  const { bootstrapState } = await import("@wcstack/state");
  return [bootstrapState];
}

export async function mount(html: string, options: MountOptions = {}): Promise<MountedApp> {
  patchInlineScriptLoader();
  patchTextSetters();

  for (const bootstrap of options.bootstrap ?? (await defaultBootstraps())) {
    await bootstrap();
  }

  const stateTagName = options.stateTagName ?? "wcs-state";
  let root: Document | ShadowRoot;
  let container: Element;
  if (options.root === "shadow") {
    const host = document.createElement("div");
    host.setAttribute("data-wcs-testing-host", "");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = html;
    document.body.appendChild(host);
    root = shadow;
    container = host;
  } else {
    document.body.innerHTML = html;
    root = document;
    container = document.body;
  }

  await waitForReady(root, { maxIterations: options.maxIterations });

  return {
    root,
    container,
    state(name = "default"): StateHandle {
      const element = [...root.querySelectorAll<StateElementLike>(stateTagName)]
        .find((el) => (el.getAttribute("name") ?? "default") === name);
      if (element === undefined) {
        throw new Error(`@wcstack/testing: no <${stateTagName}${name === "default" ? "" : ` name="${name}"`}> under the mounted root`);
      }
      return {
        element,
        read(fn) {
          let out!: ReturnType<typeof fn>;
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
      } else {
        container.remove();
      }
    },
  };
}
