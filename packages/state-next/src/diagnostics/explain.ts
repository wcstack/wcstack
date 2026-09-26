/**
 * The diagnostics add-on's sentences and guidance: a numbered core message rendered as its
 * sentence (src/diagnostics/messages.ts), then how to fix it, the nearest name and the lint
 * pointer. The add-on installs these; so does `@wcstack/state/parser`, a bundle of its own.
 */
import { didYouMean, LINT_HINT } from "./guidance";
import { FORMATS_FILTER_NAMES, hasFilter } from "../filters/registry";
import { codeOf, type M } from "../messages";
import { SENTENCES } from "./messages";

/** A numbered core message as its sentence (the number and the values if it is not known here). */
export function render(id: number, args: readonly unknown[]): string {
  const sentence = SENTENCES[id as M];
  return sentence === undefined ? `${codeOf(id)}#${id} ${args.join(" ")}` : codeOf(id) + sentence(...args);
}

/** Codes lint detects statically: only these point the author to a lint run. */
const LINT_CODES = new Set([
  "binding-syntax", "template-syntax", "filter-unknown", "filter-arity", "index-arity",
  "wildcard-rank", "token-undeclared", "binding-path-missing",
]);

/** How to fix it, by what the message says. */
const GUIDES: [RegExp, string][] = [
  [/no loop level in common with the context/, "; pass indexes ([] for all)."],
  [/"([^"#]+)#([^"]*)" is not a filter name: a modifier list .* comes before the input filters/, ' — write "<property>#$2|$1".'],
  [/\[wcs\/recursion-unsupported\]/, " It is only meaningful in a $recursion declaration, in a recursive getter key, and in the path argument of $getAll / $setAll — and only when the state declares a $recursion anchor."],
  [/must be single binding/, ' Put the structural binding alone in its own data-wcs (e.g. <template data-wcs="for: items">).'],
  [/\[wcs\/wildcard-rank\] .* needs \d+ enclosing/, ' Wrap it in that many "for" templates, or use $resolve(path, indexes) to name the row explicitly.'],
  [/\[wcs\/binding-type-expectation\] class\.([^ ]+)/, ' Write "class.$1: path|truthy" to toggle on truthiness.'],
  [/path segments — the limit/, " Every prefix of a path is interned, so the cost grows with the square of the depth."],
  [/\[wcs\/index-arity\] \$resolve/, " $resolve takes one index per \"*\"; $getAll / $setAll take at most that many (fewer expands the rest)."],
  [/"([^"#]+)#[^"]*" is not a filter name: "#" cannot appear in one/, ' Modifiers belong on the left side of the binding, before the ":" — write "$1" here.'],
];

export function explain(message: string, subject?: string, candidates?: Iterable<string>): string {
  let out = subject !== undefined && candidates !== undefined ? didYouMean(subject, candidates) : "";
  for (const [re, text] of GUIDES) {
    const m = re.exec(message);
    if (m !== null) out += text.replace(/\$(\d)/g, (_, i: string) => m[Number(i)]);
  }
  // "value#ro#wo": one modifier list — the fix joins them
  const mods = /"([^"#]+)#([^"]+)": a binding takes one modifier list/.exec(message);
  if (mods !== null) out += ` — write "${mods[1]}#${mods[2].split("#").join(",")}".`;
  // a typo on a page with no formatting filters at all: the formats add-on may be what is missing
  if (message.includes("[wcs/filter-unknown]") && !message.includes("formats add-on") && !FORMATS_FILTER_NAMES.some(hasFilter)) {
    out += " No formatting filters are installed — add them with installFormats() (the formats add-on).";
  }
  const code = /\[wcs\/([\w-]+)\]/.exec(message);
  // (the path-length limit is a runtime cost, not something lint reports)
  if (code !== null && LINT_CODES.has(code[1]) && !message.includes(" path segments — the limit is ")) out += LINT_HINT;
  return out;
}
