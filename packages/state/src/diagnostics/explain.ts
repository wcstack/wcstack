/**
 * The diagnostics add-on's sentences and guidance: a numbered core message rendered as its
 * sentence (src/diagnostics/messages.ts), then how to fix it, the nearest name and the lint
 * pointer. The add-on installs these; so does `@wcstack/state/parser`, a bundle of its own.
 */
import { didYouMean, LINT_HINT } from "./guidance";
import { FORMATS_FILTER_NAMES, hasFilter } from "../filters/registry";
import type { M } from "../messages";
import { codeOf, SENTENCES } from "./messages";

/** A numbered core message as its sentence (the number and the values if it is not known here). */
export function render(id: number, args: readonly unknown[]): string {
  const sentence = SENTENCES[id as M];
  return sentence === undefined ? `${codeOf(id)}#${id} ${args.join(" ")}` : codeOf(id) + sentence(...args);
}

/** Codes lint detects statically: only these point the author to a lint run. */
const LINT_CODES = new Set([
  "binding-syntax", "template-syntax", "filter-unknown", "filter-arity", "index-arity",
  "wildcard-rank", "token-undeclared", "binding-path-missing", "index-param-range",
]);

/** How to fix it, by what the message says. */
const GUIDES: [RegExp, string][] = [
  [/no loop level in common with the context/, "; pass indexes ([] for all)."],
  [/"([^"#]+)#([^"]*)" is not a filter name: a modifier list .* comes before the input filters/, ' — write "<property>#$2|$1".'],
  [/\[wcs\/recursion-unsupported\]/, " It is only meaningful in a $recursion declaration, in a recursive getter key, and in the path argument of $getAll / $setAll — and only when the state declares a $recursion anchor."],
  [/must be single binding/, ' Put the structural binding alone in its own data-wcs (e.g. <template data-wcs="for: items">).'],
  [/\[wcs\/wildcard-rank\] .* needs \d+ enclosing/, ' Wrap it in that many "for" templates, or use $resolve(path, indexes) to name the row explicitly.'],
  [/\[wcs\/wildcard-rank\] .* ranges over the rows of/, ' A "*" in a binding is the row of the loop around it: read a row of another list in a getter, with $resolve(path, indexes).'],
  [/\[wcs\/binding-type-expectation\] class\.([^ ]+)/, ' Write "class.$1: path|truthy" to toggle on truthiness.'],
  [/path segments — the limit/, " Every prefix of a path is interned, so the cost grows with the square of the depth."],
  [/\[wcs\/index-arity\] \$resolve/, " $resolve takes one index per \"*\"; $getAll / $setAll take at most that many (fewer expands the rest)."],
  [/"([^"#]+)#[^"]*" is not a filter name: "#" cannot appear in one/, ' Modifiers belong on the left side of the binding, before the ":" — write "$1" here.'],
];

/**
 * The filter names 3.2 renamed, which 3.x kept as aliases and 4.0 removed (3.x's `filterAliases`;
 * lint has the same table). Their message names the replacement, not the nearest name: for these
 * that is an unrelated filter (`dec` → `eq`, `fix` → `div`), and following it changes the meaning.
 */
export const RENAMED_FILTERS: Readonly<Record<string, string>> = {
  inc: "add", dec: "sub", fix: "toFixed", uc: "upper", lc: "lower", cap: "capitalize", rep: "repeat", rev: "reverse", pad: "padStart", null: "nullIfEmpty",
};

/** How to write a filter 4.0 removed, or null. */
function removedFilter(name: string): string | null {
  // 4.0 folded substr(start, length) into slice(start, end): the second argument changes meaning
  if (name === "substr") return ' "substr" was removed in 4.0 — write slice(start, start + length): slice takes the end index, not a length.';
  const to = Object.hasOwn(RENAMED_FILTERS, name) ? RENAMED_FILTERS[name] : null;
  return to === null ? null : ` "${name}" was renamed "${to}" in 3.2 and removed in 4.0 — write "${to}".`;
}

export function explain(message: string, subject?: string, candidates?: Iterable<string>): string {
  const removed = subject !== undefined && message.includes("[wcs/filter-unknown]") ? removedFilter(subject) : null;
  let out = removed ?? (subject !== undefined && candidates !== undefined ? didYouMean(subject, candidates) : "");
  for (const [re, text] of GUIDES) {
    const m = re.exec(message);
    if (m !== null) out += text.replace(/\$(\d)/g, (_, i: string) => m[Number(i)]);
  }
  // "value#ro#wo": one modifier list — the fix joins them
  const mods = /"([^"#]+)#([^"]+)": a binding takes one modifier list/.exec(message);
  if (mods !== null) out += ` — write "${mods[1]}#${mods[2].split("#").join(",")}".`;
  // a formatting filter on a page without the formats add-on (the core names installFeatures), or a
  // typo on a page with no formatting filters at all: the formats add-on may be what is missing
  if (message.includes("[wcs/filter-unknown]")) {
    if (message.includes("formats add-on")) out += ` On a split auto page: features="formats" on the root, or "$features": ["formats"].`;
    else if (!FORMATS_FILTER_NAMES.some(hasFilter)) {
      out += ` No formatting filters are installed — add the formats add-on: installFeatures([formats]) from "@wcstack/state/features/formats" (a split auto page: features="formats", or "$features").`;
    }
  }
  const code = /\[wcs\/([\w-]+)\]/.exec(message);
  // (not something lint reports: the path-length limit is a runtime cost, a template handed over at
  // the top of inserted content (#204) is the page's order of loading, not its markup, and lint's
  // manifest knows the formatting filters — one missing because the formats add-on is not installed
  // is the page's. A row of another list (#1403) and an `outerHTML:` in a template (#203) lint does
  // report, as of its 4.0 parser)
  if (code !== null && LINT_CODES.has(code[1]) && !/ path segments — the limit is |inserted content was not rendered|formats add-on/.test(message)) out += LINT_HINT;
  return out;
}
