/**
 * The loader for a Declarative Custom Component kept in a file of its own (@wcstack/state's
 * `data-wc-definition`, README "Declarative Custom Components").
 *
 * A DCC's definition is markup — `<my-part data-wc-definition><template shadowrootmode>…` — which
 * the browser turns into a shadow root only while it parses a page: written into each page, or
 * brought in by a script. This loader is that script: it fetches the file, parses it with
 * `setHTMLUnsafe()` (the parser API that keeps declarative shadow roots; `innerHTML` and a cloned
 * `<template>` drop them, with a console message in Chromium only) and puts the definitions in the
 * page, where @wcstack/state defines their tags. So one file serves every page, and a page names
 * the parts it uses in its import map, as for a class's module (docs/seam-apps.md, garden-plots).
 *
 * The definitions go into the document: a scoped registry is not served.
 */
import { LoaderFunction } from "./types.js";

/** How long a definition may take to define its tag (@wcstack/state does, once it has loaded). */
export const DCC_DEFINE_TIMEOUT = 10000;

const NAME = "[@wcstack/autoloader]";

/** The page's Trusted Types policy, where wcstack's packages share one (docs/csp.md). */
function trusted(html: string): string {
  const policy = (globalThis as { [key: symbol]: unknown })[Symbol.for("wcstack.trustedTypes.policy")] as
    { createHTML?: (input: string) => unknown } | null | undefined;
  return (typeof policy?.createHTML === "function" ? policy.createHTML(html) : html) as string;
}

/** Where the loaded definitions live: one hidden element at the end of the page. */
function container(): Element {
  const id = "wcs-autoloader-definitions";
  let host = document.getElementById(id);
  if (host === null) {
    host = document.createElement("div");
    host.id = id;
    host.hidden = true;
    (document.body ?? document.documentElement).append(host);
  }
  return host;
}

/**
 * Makes the loader. `resolve` turns what the autoloader hands a loader — the import-map specifier,
 * `"@components/my-part|dcc"` or `"@components/ui|dcc/part.html"` — into the file's URL.
 */
export function createDccLoader(
  resolve: (specifier: string) => string = (specifier) => import.meta.resolve(specifier),
  timeout: number = DCC_DEFINE_TIMEOUT,
): LoaderFunction {
  return async (path: string): Promise<CustomElementConstructor | null> => {
    const url = resolve(path);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${NAME} ${url}: HTTP ${response.status}`);
    const text = await response.text();
    const holder = document.createElement("div") as Element & { setHTMLUnsafe?: (html: string) => void };
    if (typeof holder.setHTMLUnsafe !== "function") {
      throw new Error(`${NAME} ${url}: this browser has no setHTMLUnsafe(), which a Declarative Custom Component in a file needs.`);
    }
    holder.setHTMLUnsafe(trusted(text));
    const definitions = Array.from(holder.querySelectorAll("[data-wc-definition]"));
    if (definitions.length === 0) throw new Error(`${NAME} ${url} has no element with data-wc-definition.`);
    const pending: string[] = [];
    for (const definition of definitions) {
      // (a tag defined already — the same file under two keys, a copy written in the page — is left as it is)
      if (customElements.get(definition.localName) === undefined) {
        pending.push(definition.localName);
        container().append(definition);
      }
    }
    // Its tag is defined by @wcstack/state, when the definition's own <wcs-state> has loaded. Waited for —
    // the autoloader takes a class from a loader — but not for ever: a page without @wcstack/state would
    // hold every other load back
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(pending.map((tag) => customElements.whenDefined(tag))),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            `${NAME} ${url}: <${pending.join(">, <")}> ${pending.length === 1 ? "was" : "were"} not defined within ${timeout} ms. A Declarative Custom Component is defined by @wcstack/state: load it on the page.`,
          )), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return customElements.get(definitions[0].localName) as CustomElementConstructor;
  };
}

export const loadDcc: LoaderFunction = createDccLoader();
