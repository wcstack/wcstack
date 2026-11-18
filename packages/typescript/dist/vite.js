import { readFileSync, statSync } from 'node:fs';
import { basename, posix, resolve, relative } from 'node:path';

/**
 * htmlTags.ts — find, in an HTML file, what the Vite plugin (vite.ts) has to touch:
 * the `src` of every `<wcs-state>` start tag, and every inline `<script type="module">`
 * inside a `<wcs-state>` or a `<wcs-guard-handler>`; and resolve such a `src` to a
 * path of the project the way the page does.
 *
 * A small scanner instead of an HTML parser keeps the package free of runtime
 * dependencies. It reads tags the way the HTML tokenizer does where it matters here:
 * comments, `<!…>` / `<?…>` declarations and the text of raw-text elements (`<script>`,
 * `<style>`, `<textarea>`, `<title>` …) are skipped, so a tag written inside them is not
 * a tag; attribute values may be double-, single- or un-quoted; the first of two
 * attributes with the same name wins. The text of a `<template>` is markup like any
 * other, so a tag inside one is found.
 */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);
const TAG_NAME = /[a-zA-Z][^\s/>]*/y;
const SPACE = /[\s/]*/y;
const ATTR_NAME = /[^\s/>][^\s/>=]*/y;
const EQUALS = /\s*=\s*/y;
const UNQUOTED = /[^\s>]*/y;
function sticky(re, text, at) {
    re.lastIndex = at;
    return re.exec(text);
}
/** Attributes of the start tag whose name ends at `at`; returns them and the offset after `>`. */
function readAttributes(html, at) {
    const attributes = [];
    let i = at;
    for (;;) {
        i += sticky(SPACE, html, i)[0].length;
        if (i >= html.length)
            return { attributes, end: html.length };
        if (html[i] === ">")
            return { attributes, end: i + 1 };
        const name = sticky(ATTR_NAME, html, i);
        i += name[0].length;
        const equals = sticky(EQUALS, html, i);
        let value = "";
        let valueStart = i;
        let valueEnd = i;
        if (equals !== null) {
            i += equals[0].length;
            const quote = html[i];
            if (quote === '"' || quote === "'") {
                const close = html.indexOf(quote, i + 1);
                valueStart = i + 1;
                valueEnd = close < 0 ? html.length : close;
                i = close < 0 ? html.length : close + 1;
            }
            else {
                valueStart = i;
                valueEnd = i + sticky(UNQUOTED, html, i)[0].length;
                i = valueEnd;
            }
            value = html.slice(valueStart, valueEnd);
        }
        const lower = name[0].toLowerCase();
        if (!attributes.some((a) => a.name === lower))
            attributes.push({ name: lower, value, valueStart, valueEnd });
    }
}
/** Offset after the end tag `</name …>` that closes raw text starting at `from`. */
function skipRawText(html, from, name) {
    const close = new RegExp(`</${name}(?=[\\s/>])[^>]*>?`, "ig");
    close.lastIndex = from;
    const m = close.exec(html);
    return m === null ? html.length : m.index + m[0].length;
}
/** The origin page URLs are resolved against: a src that leaves it is not a file of the project. */
const ORIGIN = "http://wcstack.invalid";
/**
 * The path, under the project root, that `src` names for a page served at `pagePath`
 * (with the page's `<base href>`, as the engine resolves it against `document.baseURI`),
 * or undefined for a URL outside the project (another origin, `data:`, `blob:` …).
 */
function resolveStateSrc(src, pagePath, baseHref) {
    try {
        const page = new URL(pagePath, ORIGIN);
        const base = baseHref === undefined ? page : new URL(baseHref, page);
        const url = new URL(src.trim(), base);
        if (url.origin !== ORIGIN || url.protocol !== "http:")
            return undefined;
        try {
            return decodeURIComponent(url.pathname);
        }
        catch {
            return url.pathname;
        }
    }
    catch {
        return undefined;
    }
}
function scanWcstackHtml(html, options = {}) {
    const stateTag = (options.stateTag ?? "wcs-state").toLowerCase();
    const guardHandlerTag = (options.guardHandlerTag ?? "wcs-guard-handler").toLowerCase();
    const stateSrcs = [];
    const inlineScripts = [];
    let baseHref;
    // open <wcs-state> / <wcs-guard-handler> elements around the current position
    let depth = 0;
    let i = 0;
    while (i < html.length) {
        const lt = html.indexOf("<", i);
        if (lt < 0)
            break;
        if (html.startsWith("<!--", lt)) {
            const end = html.indexOf("-->", lt + 4);
            i = end < 0 ? html.length : end + 3;
            continue;
        }
        const next = html[lt + 1];
        if (next === "!" || next === "?") {
            const end = html.indexOf(">", lt);
            i = end < 0 ? html.length : end + 1;
            continue;
        }
        if (next === "/") {
            const name = sticky(TAG_NAME, html, lt + 2);
            if (name === null) {
                i = lt + 2;
                continue;
            }
            const lower = name[0].toLowerCase();
            if ((lower === stateTag || lower === guardHandlerTag) && depth > 0)
                depth--;
            const end = html.indexOf(">", lt);
            i = end < 0 ? html.length : end + 1;
            continue;
        }
        const name = sticky(TAG_NAME, html, lt + 1);
        if (name === null) {
            i = lt + 1;
            continue;
        }
        const lower = name[0].toLowerCase();
        const { attributes, end } = readAttributes(html, lt + 1 + name[0].length);
        const attr = (n) => attributes.find((a) => a.name === n);
        i = end;
        if (lower === stateTag) {
            const src = attr("src");
            if (src !== undefined && src.value.trim() !== "")
                stateSrcs.push(src);
            depth++;
        }
        else if (lower === guardHandlerTag) {
            depth++;
        }
        else if (lower === "base") {
            baseHref ??= attr("href")?.value;
        }
        else if (lower === "script") {
            const isModule = attr("type")?.value.trim().toLowerCase() === "module";
            if (depth > 0 && isModule && attr("src") === undefined && attr("vite-ignore") === undefined) {
                inlineScripts.push(lt + "<script".length);
            }
            i = skipRawText(html, end, "script");
        }
        else if (RAW_TEXT.has(lower)) {
            i = skipRawText(html, end, lower);
        }
    }
    return { stateSrcs, inlineScripts, baseHref };
}

// vite.ts — `@wcstack/typescript/vite`, a Vite plugin for pages written with wcstack tags (what it
// does is in the JSDoc of `wcstack()` below, which an editor shows).
//
// The build rewrite is three hooks: the `pre` HTML transform puts a placeholder in place of each
// src and notes the file; the `transform` of that HTML entry (by then a JavaScript module) emits
// the file; `generateBundle` (the plugin is `enforce: "post"`, so Vite has written the HTML asset)
// replaces the placeholder with the emitted file's URL. Only documented hook contexts are used.
// Only Vite's types are imported: the package keeps zero runtime dependencies.
const PLACEHOLDER = /__WCSTACK_STATE_SRC_(\d+)__/g;
const toSlash = (path) => path.replace(/\\/g, "/");
function isFile(path) {
    try {
        return statSync(path).isFile();
    }
    catch {
        return false;
    }
}
function escapeAttribute(value) {
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
function wcstack(options = {}) {
    const stateTag = options.tagNames?.state ?? "wcs-state";
    const guardHandlerTag = options.tagNames?.guardHandler ?? "wcs-guard-handler";
    const marks = [`<${stateTag.toLowerCase()}`, `<${guardHandlerTag.toLowerCase()}`];
    let config;
    // per build: placeholder number → what it stands for; the HTML entry → its placeholders not emitted
    // yet; a file → its emitted reference; a placeholder → its reference
    let targets = [];
    let pending = new Map();
    let emitted = new Map();
    let references = new Map();
    function devSrc(src, ctx, baseHref) {
        const url = src.trim();
        if (url[0] === "/" && url[1] !== "/")
            return posix.join(config.base, url);
        const isRelative = url[0] === "." || (/^\w/.test(url) && !url.includes(":"));
        const fallback = ctx.originalUrl !== undefined && ctx.originalUrl !== "/" && ctx.path === "/index.html";
        if (isRelative && fallback && baseHref === undefined)
            return posix.join(config.base, url);
        return undefined;
    }
    function buildTarget(src, ctx, baseHref) {
        const path = resolveStateSrc(src, ctx.path, baseHref);
        if (path === undefined)
            return undefined;
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
    function builtUrl(fileName, htmlFileName) {
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
                if (!marks.some((mark) => lower.includes(mark)))
                    return undefined;
                const scan = scanWcstackHtml(html, { stateTag, guardHandlerTag });
                const edits = scan.inlineScripts.map((at) => ({ start: at, end: at, text: " vite-ignore" }));
                const dev = ctx.server !== undefined;
                const page = toSlash(ctx.filename);
                for (const src of scan.stateSrcs) {
                    if (dev) {
                        // the attribute text as written, with the base in front: it stays valid attribute text
                        const url = devSrc(src.value, ctx, scan.baseHref);
                        if (url !== undefined && url !== src.value)
                            edits.push({ start: src.valueStart, end: src.valueEnd, text: url });
                        continue;
                    }
                    const target = buildTarget(src.value, ctx, scan.baseHref);
                    if (target === undefined)
                        continue;
                    const n = targets.push(target) - 1;
                    pending.set(page, [...(pending.get(page) ?? []), n]);
                    edits.push({ start: src.valueStart, end: src.valueEnd, text: `__WCSTACK_STATE_SRC_${n}__` });
                }
                if (edits.length === 0)
                    return undefined;
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
                if (numbers === undefined)
                    return null;
                pending.delete(page);
                for (const n of numbers) {
                    const target = targets[n];
                    if (target.kind === "public")
                        continue;
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
                if (file.type !== "asset" || !file.fileName.endsWith(".html"))
                    continue;
                const source = typeof file.source === "string" ? file.source : new TextDecoder().decode(file.source);
                if (!source.includes("__WCSTACK_STATE_SRC_"))
                    continue;
                file.source = source.replace(PLACEHOLDER, (placeholder, digits) => {
                    const n = Number(digits);
                    const target = targets[n];
                    const reference = references.get(n);
                    if (target === undefined)
                        return placeholder;
                    if (target.kind === "public")
                        return escapeAttribute(builtUrl(target.fileName, file.fileName));
                    if (reference === undefined)
                        return placeholder;
                    return escapeAttribute(builtUrl(this.getFileName(reference), file.fileName));
                });
            }
        },
    };
}

export { wcstack as default, wcstack };
//# sourceMappingURL=vite.js.map
