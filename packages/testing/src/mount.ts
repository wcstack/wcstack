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

import { pathToFileURL } from "node:url";
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
  /**
   * The local file a `<wcs-state src>` module is read from. It gets the URL the page names (resolved
   * against `document.baseURI`, an `http:` URL under happy-dom, which Node's module loader does not
   * read — it reads `file:` and `data:` URLs only) and returns a path or a `file:` URL, e.g.
   * `(url) => new URL("." + url.pathname, import.meta.url)`. The same contract as
   * `renderToString({ resolveModule })` (`@wcstack/server`). Installed for the length of the mount;
   * each mount imports the module anew, so tests do not share a state object. Without it — or when it
   * returns nothing — a `src` module state fails to initialize with a message saying so. A `.json`
   * `src` is fetched, as before.
   */
  readonly resolveModule?: (url: URL) => string | URL | null | undefined;
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
  /**
   * Accessor for the root `<wcs-state>` (v2: one state tree per root — volumes
   * (`mount=`) and `bind-component` elements are not it). Throws if absent.
   */
  state(): StateHandle;
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

/**
 * The global key a renderer installs its module resolver under, for `<wcs-state src>` (the
 * ssr-snapshot protocol's `SSR_MODULE_RESOLVER_KEY`, /protocol/ssr-snapshot.ts): `Symbol.for`, so
 * `@wcstack/state` reads the same key without either package importing the other's copy.
 */
const MODULE_RESOLVER_KEY = Symbol.for("wcstack.ssr.resolveModule");

/** The number of the mount (each mount's `src` modules are its own). */
let mounts = 0;

/**
 * Puts a resolver for `<wcs-state src>` modules on the global key for the length of one mount, as
 * `renderToString` does for a render: `file:` / `data:` are imported as they are, any other URL from
 * the file `resolve` returns — with the mount's number in its query, since Node keeps a module per URL
 * (without it, every mount would get the first mount's state object). Without `resolve`, or when it
 * returns nothing, it throws saying what to do (Node's own error was `ERR_UNSUPPORTED_ESM_URL_SCHEME`).
 * Returns the function that puts back what was there.
 */
function installModuleResolver(resolve: MountOptions["resolveModule"]): () => void {
  const g = globalThis as Record<symbol, unknown>;
  const had = Object.prototype.hasOwnProperty.call(g, MODULE_RESOLVER_KEY);
  const previous = g[MODULE_RESOLVER_KEY];
  const n = ++mounts;
  g[MODULE_RESOLVER_KEY] = (url: string): string | null => {
    const u = new URL(url);
    if (u.protocol === "file:" || u.protocol === "data:") return null;
    const local = resolve?.(u);
    if (local === null || local === undefined) {
      throw new Error(
        `@wcstack/testing: <wcs-state src> names ${url}, which Node cannot import (its loader reads file: and data: URLs). ` +
        (resolve === undefined
          ? `Pass mount(html, { resolveModule }) to map it to a local file — e.g. resolveModule: (url) => new URL("." + url.pathname, import.meta.url) — or write the state in the HTML (json=, or an inline <script type="module">).`
          : "resolveModule returned no file for it."),
      );
    }
    const file = local instanceof URL ? new URL(local.href) : /^file:/i.test(local) ? new URL(local) : pathToFileURL(local);
    file.searchParams.set("wcs-mount", String(n));
    return file.href;
  };
  return () => {
    if (had) g[MODULE_RESOLVER_KEY] = previous;
    else delete g[MODULE_RESOLVER_KEY];
  };
}

/**
 * A `<wcs-state>` in `html` that would wait for `setInitialState()`: none of `state` / `src` / `json`
 * and no inline `<script type="module">` (the element's resolution order, @wcstack/state README "State
 * Initialization"). A test cannot call `setInitialState()` before `mount()` returns, so `mount()` would
 * never resolve — it used to time out without a word. A root or a volume (`mount=`); not a
 * `bind-component` element (its state is its host's property), and not one inside a `<template>`
 * (template content is not in the page: a `for:` / `if:` row, a route, a DCC definition).
 */
function findWaitingState(html: string, stateTagName: string): Element | undefined {
  const probe = document.createElement("template");
  probe.innerHTML = html;
  return [...probe.content.querySelectorAll(stateTagName)].find((el) =>
    !el.hasAttribute("bind-component") &&
    !el.hasAttribute("state") &&
    !el.hasAttribute("src") &&
    !el.hasAttribute("json") &&
    el.querySelector('script[type="module"]') === null);
}

/** `<wcs-state mount="cfg">` — the element as written (its start tag), for a message. */
function startTag(el: Element): string {
  const attributes = [...el.attributes].map((a) => (a.value === "" ? ` ${a.name}` : ` ${a.name}="${a.value}"`));
  return `<${el.localName}${attributes.join("")}>`;
}

async function defaultBootstraps(): Promise<readonly BootstrapFunction[]> {
  // Lazy: the element classes bind their base class at module evaluation, which
  // must happen after the DOM globals exist (installDom() in bare Node).
  const { bootstrapState } = await import("@wcstack/state");
  return [bootstrapState];
}

export async function mount(html: string, options: MountOptions = {}): Promise<MountedApp> {
  const stateTagName = options.stateTagName ?? "wcs-state";
  const waiting = findWaitingState(html, stateTagName);
  if (waiting !== undefined) {
    throw new Error(
      `@wcstack/testing: ${startTag(waiting)} has no state to load (no state, src or json attribute, and no inline <script type="module">), ` +
      `so it waits for setInitialState() — which a test cannot call before mount() returns: mount() would never resolve. ` +
      `Give it its state in the HTML: json='{"count": 0}', an inline <script type="module">export default { … }</script>, ` +
      `or src="./state.js" with mount(html, { resolveModule }).`,
    );
  }

  patchInlineScriptLoader();
  patchTextSetters();

  for (const bootstrap of options.bootstrap ?? (await defaultBootstraps())) {
    await bootstrap();
  }

  let root: Document | ShadowRoot;
  let container: Element;
  const restoreResolver = installModuleResolver(options.resolveModule);
  try {
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
  } finally {
    restoreResolver();
  }

  return {
    root,
    container,
    state(...legacyArgs: never[]): StateHandle {
      if (legacyArgs.length > 0) {
        throw new Error(
          `@wcstack/testing: state(name) was removed in v2 — there is one state tree per root. ` +
          `Mount the named state onto the tree (<wcs-state mount="...">) and read it by its path prefix via state().`,
        );
      }
      const element = [...root.querySelectorAll<StateElementLike>(stateTagName)]
        .find((el) => !el.hasAttribute("mount") && !el.hasAttribute("bind-component"));
      if (element === undefined) {
        throw new Error(`@wcstack/testing: no <${stateTagName}> under the mounted root`);
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
