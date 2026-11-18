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

export interface AttributeSpan {
  /** Lower-cased. */
  readonly name: string;
  /** The text between the quotes as written (character references are not decoded). */
  readonly value: string;
  /** Offsets of the value itself (inside the quotes), for an in-place rewrite. */
  readonly valueStart: number;
  readonly valueEnd: number;
}

export interface WcstackHtmlScan {
  /** `src` of each `<wcs-state>` start tag, in document order (an empty `src` is left out). */
  readonly stateSrcs: readonly AttributeSpan[];
  /** Offsets right after `<script` of each inline module script inside `<wcs-state>` / `<wcs-guard-handler>`. */
  readonly inlineScripts: readonly number[];
  /** The `href` of the document's first `<base>`, if any. */
  readonly baseHref: string | undefined;
}

export interface ScanOptions {
  /** Default `wcs-state`. */
  readonly stateTag?: string;
  /** Default `wcs-guard-handler`. */
  readonly guardHandlerTag?: string;
}

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);
const TAG_NAME = /[a-zA-Z][^\s/>]*/y;
const SPACE = /[\s/]*/y;
const ATTR_NAME = /[^\s/>][^\s/>=]*/y;
const EQUALS = /\s*=\s*/y;
const UNQUOTED = /[^\s>]*/y;

function sticky(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

/** Attributes of the start tag whose name ends at `at`; returns them and the offset after `>`. */
function readAttributes(html: string, at: number): { attributes: AttributeSpan[]; end: number } {
  const attributes: AttributeSpan[] = [];
  let i = at;
  for (;;) {
    i += sticky(SPACE, html, i)![0].length;
    if (i >= html.length) return { attributes, end: html.length };
    if (html[i] === ">") return { attributes, end: i + 1 };
    const name = sticky(ATTR_NAME, html, i)!;
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
      } else {
        valueStart = i;
        valueEnd = i + sticky(UNQUOTED, html, i)![0].length;
        i = valueEnd;
      }
      value = html.slice(valueStart, valueEnd);
    }
    const lower = name[0].toLowerCase();
    if (!attributes.some((a) => a.name === lower)) attributes.push({ name: lower, value, valueStart, valueEnd });
  }
}

/** Offset after the end tag `</name …>` that closes raw text starting at `from`. */
function skipRawText(html: string, from: number, name: string): number {
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
export function resolveStateSrc(src: string, pagePath: string, baseHref?: string): string | undefined {
  try {
    const page = new URL(pagePath, ORIGIN);
    const base = baseHref === undefined ? page : new URL(baseHref, page);
    const url = new URL(src.trim(), base);
    if (url.origin !== ORIGIN || url.protocol !== "http:") return undefined;
    try {
      return decodeURIComponent(url.pathname);
    } catch {
      return url.pathname;
    }
  } catch {
    return undefined;
  }
}

export function scanWcstackHtml(html: string, options: ScanOptions = {}): WcstackHtmlScan {
  const stateTag = (options.stateTag ?? "wcs-state").toLowerCase();
  const guardHandlerTag = (options.guardHandlerTag ?? "wcs-guard-handler").toLowerCase();
  const stateSrcs: AttributeSpan[] = [];
  const inlineScripts: number[] = [];
  let baseHref: string | undefined;
  // open <wcs-state> / <wcs-guard-handler> elements around the current position
  let depth = 0;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
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
      if ((lower === stateTag || lower === guardHandlerTag) && depth > 0) depth--;
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
    const attr = (n: string): AttributeSpan | undefined => attributes.find((a) => a.name === n);
    i = end;
    if (lower === stateTag) {
      const src = attr("src");
      if (src !== undefined && src.value.trim() !== "") stateSrcs.push(src);
      depth++;
    } else if (lower === guardHandlerTag) {
      depth++;
    } else if (lower === "base") {
      baseHref ??= attr("href")?.value;
    } else if (lower === "script") {
      const isModule = attr("type")?.value.trim().toLowerCase() === "module";
      if (depth > 0 && isModule && attr("src") === undefined && attr("vite-ignore") === undefined) {
        inlineScripts.push(lt + "<script".length);
      }
      i = skipRawText(html, end, "script");
    } else if (RAW_TEXT.has(lower)) {
      i = skipRawText(html, end, lower);
    }
  }
  return { stateSrcs, inlineScripts, baseHref };
}
