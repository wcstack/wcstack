// vite.ts — `@wcstack/typescript/vite`, a Vite plugin for pages written with wcstack tags (what it
// does is in the JSDoc of `wcstack()` below, which an editor shows).
//
// The build rewrite is three hooks: the `pre` HTML transform puts a placeholder in place of each
// src and notes the file; the `transform` of that HTML entry (by then a JavaScript module) emits
// the file; `generateBundle` (the plugin is `enforce: "post"`, so Vite has written the HTML asset)
// replaces the placeholder with the emitted file's URL. Only documented hook contexts are used.
// Only Vite's types are imported: the package keeps zero runtime dependencies.

import { readFileSync, statSync } from "node:fs";
import { basename, posix, relative, resolve } from "node:path";
import type { IndexHtmlTransformContext, Plugin, ResolvedConfig } from "vite";
import { resolveStateSrc, scanWcstackHtml } from "./htmlTags.js";

export interface WcstackViteOptions {
  /**
   * The tag names, when the page renames them (`bootstrapState({ tagNames: { state } })`,
   * the router's `tagNames.guardHandler`). Default `wcs-state` / `wcs-guard-handler`.
   */
  readonly tagNames?: { readonly state?: string; readonly guardHandler?: string };
}

type Target =
  | { readonly kind: "module" | "json"; readonly file: string }
  | { readonly kind: "public"; readonly fileName: string };

const PLACEHOLDER = /__WCSTACK_STATE_SRC_(\d+)__/g;

const toSlash = (path: string): string => path.replace(/\\/g, "/");

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The Vite plugin for pages written with wcstack tags (`plugins: [wcstack()]`).
 *
 * - `<wcs-state src="./state.ts">`: the engine loads the file with `import(src)` at run time, so
 *   Vite never sees it — the dev server serves it on request, but `vite build` would keep the
 *   attribute and emit no file. In a build, every local `src` of a `<wcs-state>` (the root state
 *   and `mount` volumes alike) is emitted as its own chunk with its `export default` kept (it shares
 *   chunks with the page's bundle), and the attribute becomes that file's URL under `base`. A `.json`
 *   src is emitted as an asset (the engine fetches a `.json` URL), a `publicDir` file is copied as it
 *   is, an external URL is left alone, and a local src with no file behind it fails the build.
 * - An inline `<script type="module">` inside `<wcs-state>` or `<wcs-guard-handler>` is the state or
 *   the guard, read by the element: Vite would move it into its bundle (dev and build). The plugin
 *   marks it `vite-ignore`, so Vite leaves it in the page.
 *
 * In dev a `src` is rewritten only the way Vite rewrites a `<script src>`: an absolute path gets the
 * `base`, and a relative one becomes absolute when the SPA fallback serves index.html for a deeper
 * URL (unless the page has a `<base>`).
 */
export function wcstack(options: WcstackViteOptions = {}): Plugin {
  const stateTag = options.tagNames?.state ?? "wcs-state";
  const guardHandlerTag = options.tagNames?.guardHandler ?? "wcs-guard-handler";
  const marks = [`<${stateTag.toLowerCase()}`, `<${guardHandlerTag.toLowerCase()}`];
  let config: ResolvedConfig;
  // per build: placeholder number → what it stands for; the HTML entry → its placeholders not emitted
  // yet; a file → its emitted reference; a placeholder → its reference
  let targets: Target[] = [];
  let pending = new Map<string, number[]>();
  let emitted = new Map<string, string>();
  let references = new Map<number, string>();

  function devSrc(src: string, ctx: IndexHtmlTransformContext, baseHref: string | undefined): string | undefined {
    const url = src.trim();
    if (url[0] === "/" && url[1] !== "/") return posix.join(config.base, url);
    const isRelative = url[0] === "." || (/^\w/.test(url) && !url.includes(":"));
    const fallback = ctx.originalUrl !== undefined && ctx.originalUrl !== "/" && ctx.path === "/index.html";
    if (isRelative && fallback && baseHref === undefined) return posix.join(config.base, url);
    return undefined;
  }

  function buildTarget(src: string, ctx: IndexHtmlTransformContext, baseHref: string | undefined): Target | undefined {
    const path = resolveStateSrc(src, ctx.path, baseHref);
    if (path === undefined) return undefined;
    if (config.publicDir && isFile(resolve(config.publicDir, `.${path}`))) {
      return { kind: "public", fileName: path.slice(1) };
    }
    const file = toSlash(resolve(config.root, `.${path}`));
    if (!isFile(file)) {
      const page = toSlash(relative(config.root, ctx.filename));
      throw new Error(`[wcstack] <${stateTag} src="${src}"> in ${page}: no such file ${file}`);
    }
    return { kind: /\.json$/i.test(file) ? "json" : "module", file };
  }

  function builtUrl(fileName: string, htmlFileName: string): string {
    const encoded = encodeURI(fileName);
    if (config.base === "" || config.base === "./") {
      const path = posix.relative(posix.dirname(htmlFileName), encoded);
      return path.startsWith("../") ? path : `./${path}`;
    }
    return config.base + encoded;
  }

  return {
    name: "wcstack",
    enforce: "post",
    configResolved(resolved) {
      config = resolved;
    },
    buildStart() {
      targets = [];
      pending = new Map();
      emitted = new Map();
      references = new Map();
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const lower = html.toLowerCase();
        if (!marks.some((mark) => lower.includes(mark))) return undefined;
        const scan = scanWcstackHtml(html, { stateTag, guardHandlerTag });
        const edits: { start: number; end: number; text: string }[] = scan.inlineScripts.map((at) => ({ start: at, end: at, text: " vite-ignore" }));
        const dev = ctx.server !== undefined;
        const page = toSlash(ctx.filename);
        for (const src of scan.stateSrcs) {
          if (dev) {
            // the attribute text as written, with the base in front: it stays valid attribute text
            const url = devSrc(src.value, ctx, scan.baseHref);
            if (url !== undefined && url !== src.value) edits.push({ start: src.valueStart, end: src.valueEnd, text: url });
            continue;
          }
          const target = buildTarget(src.value, ctx, scan.baseHref);
          if (target === undefined) continue;
          const n = targets.push(target) - 1;
          pending.set(page, [...(pending.get(page) ?? []), n]);
          edits.push({ start: src.valueStart, end: src.valueEnd, text: `__WCSTACK_STATE_SRC_${n}__` });
        }
        if (edits.length === 0) return undefined;
        let out = html;
        for (const edit of edits.sort((a, b) => b.start - a.start)) {
          out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
        }
        return out;
      },
    },
    transform: {
      filter: { id: /\.html$/ },
      handler(_code, id) {
        const page = toSlash(id);
        const numbers = pending.get(page);
        if (numbers === undefined) return null;
        pending.delete(page);
        for (const n of numbers) {
          const target = targets[n];
          if (target.kind === "public") continue;
          let reference = emitted.get(target.file);
          if (reference === undefined) {
            reference = target.kind === "json"
              ? this.emitFile({ type: "asset", name: basename(target.file), originalFileName: target.file, source: readFileSync(target.file) })
              : this.emitFile({ type: "chunk", id: target.file, preserveSignature: "strict" });
            emitted.set(target.file, reference);
          }
          references.set(n, reference);
        }
        return null;
      },
    },
    generateBundle(_output, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
        const source = typeof file.source === "string" ? file.source : new TextDecoder().decode(file.source);
        if (!source.includes("__WCSTACK_STATE_SRC_")) continue;
        file.source = source.replace(PLACEHOLDER, (placeholder, digits: string) => {
          const n = Number(digits);
          const target = targets[n];
          const reference = references.get(n);
          if (target === undefined) return placeholder;
          if (target.kind === "public") return escapeAttribute(builtUrl(target.fileName, file.fileName));
          if (reference === undefined) return placeholder;
          return escapeAttribute(builtUrl(this.getFileName(reference), file.fileName));
        });
      }
    },
  };
}

export default wcstack;
