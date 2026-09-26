/**
 * The diagnostics add-on (@wcstack/state/features/diagnostics): the self-fix guidance of error
 * messages. The core states the code and the fact (`[wcs/index-arity] $resolve("m.*.*") takes
 * 2 index(es), got 1.`); with this installed, the message also carries the nearest name
 * (did-you-mean, the same rule as lint), how to fix it, and a pointer to lint where lint
 * really detects the case. The full `auto` bundle installs it.
 */
import { addHook, hooks, type Feature } from "../hooks";
import type { Engine } from "../engine";
import type { Binding } from "../dom/view";
import { getTrustedTypesPolicy, isHtmlSink } from "../trustedTypes";
import { didYouMean, LINT_HINT } from "../diagnostics/guidance";
import { FORMATS_FILTER_NAMES, hasFilter } from "../filters/registry";

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
  [/the right side of a binding must name a state path/, ' Write "<property>: <path>"; "." alone and a leading "." are the loop-relative shorthand.'],
  [/the left side of a binding must name a property/, ' Write "<property>: <path>" (modifiers and input filters come after the name).'],
  [/path segments — the limit/, " Every prefix of a path is interned, so the cost grows with the square of the depth."],
  [/\[wcs\/index-arity\] \$resolve/, " $resolve takes one index per \"*\"; $getAll / $setAll take at most that many (fewer expands the rest)."],
  [/"([^"]*\))[^"]*": unexpected "([^"]+)" after the filter's closing/, ' Separate filters with "|" (write "$1|$2").'],
  [/"([^"#]+)#[^"]*" is not a filter name: "#" cannot appear in one/, ' Modifiers belong on the left side of the binding, before the ":" — write "$1" here.'],
];

function explain(message: string, subject?: string, candidates?: Iterable<string>): string {
  let out = subject !== undefined && candidates !== undefined ? didYouMean(subject, candidates) : "";
  for (const [re, text] of GUIDES) {
    const m = re.exec(message);
    if (m !== null) out += text.replace(/\$(\d)/g, (_, i: string) => m[Number(i)]);
  }
  // a typo on a page with no formatting filters at all: the formats add-on may be what is missing
  if (message.includes("[wcs/filter-unknown]") && !message.includes("formats add-on") && !FORMATS_FILTER_NAMES.some(hasFilter)) {
    out += " No formatting filters are installed — add them with installFormats() (the formats add-on).";
  }
  const code = /\[wcs\/([\w-]+)\]/.exec(message);
  if (code !== null && LINT_CODES.has(code[1])) out += LINT_HINT;
  return out;
}

let trustedTypesReported = false;

/**
 * An HTML sink write Trusted Types blocked: the browser's message names no fix, so say once
 * per page what to install (the same report as @wcstack/state 3.3).
 */
function failed(_engine: Engine, error: unknown, binding: Binding): void {
  const prop = binding.name === "html" ? "innerHTML" : binding.name;
  if (trustedTypesReported || !(error instanceof TypeError) || !isHtmlSink(prop) || !("trustedTypes" in globalThis)) return;
  trustedTypesReported = true;
  const cause = typeof getTrustedTypesPolicy()?.createHTML === "function"
    ? "The injected policy's createHTML() did not return a TrustedHTML."
    : "No sanitizing policy is installed, and @wcstack/state deliberately does not pass state values through an identity policy — that would defeat the CSP.";
  console.error(
    `[@wcstack/state] Writing to "${prop}" was blocked by Trusted Types (require-trusted-types-for 'script'). ${cause}\n`
    + `Install a sanitizing policy before the first binding is applied:\n`
    + `  globalThis[Symbol.for("wcstack.trustedTypes.policy")] =\n`
    + `    trustedTypes.createPolicy("my-app", { createHTML: (s) => DOMPurify.sanitize(s) });\n`
    + `Or bind the value as text instead of HTML. See docs/csp.md section 7.`,
    { element: binding.node, property: prop },
  );
}

export const diagnostics: Feature = {
  name: "diagnostics",
  install(): void {
    hooks.explain = explain;
    addHook("failed", failed);
  },
};
export default diagnostics;
