/**
 * parser.differential.test.ts — the 4.0 `data-wcs` parser against the frozen 3.5.4 one
 * (docs/verification-practices-study.md §2.5 (b)).
 *
 * 4.0's parser (src/parser/) is a port of 3.x's bindTextParser, and the tooling entry
 * (`@wcstack/state/parser`) keeps 3.x's result shape. fast-check generates binding texts from the grammar —
 * properties, modifiers, paths, filters on both sides, quoted arguments, whitespace — and strings of the
 * grammar's characters, and checks that the two parsers agree: the same result when both accept a text, and
 * no text that only one of them refuses. A difference that 4.0 made on purpose goes in APPROVED, with why.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import * as neo from "../src/public/parser";
// (3.5.4's built parser entry, frozen with the public-surface fixture)
// @ts-expect-error — a built bundle with no declaration beside it
import * as old from "./fixtures/state-3.5.4/parser.esm.js";

/** The result as plain data: the path info as its path, keys in order. */
function plain(r: unknown): string {
  return JSON.stringify(r, (k, v) => {
    if (k === "statePathInfo") return v?.path ?? null;
    if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]]));
    return v;
  });
}
type Outcome = { ok: string } | { error: true };
function outcome(parse: (text: string) => unknown, text: string): Outcome {
  try {
    return { ok: plain(parse(text)) };
  } catch {
    return { error: true };
  }
}

/** The differences 4.0 made on purpose: a text they cover may parse differently. */
const APPROVED: { why: string; covers: (text: string) => boolean }[] = [];

const ident = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,4}$/);
const ws = fc.constantFrom("", "", " ", "  ", "\n");
const segment = fc.oneof(ident, fc.constant("*"), fc.integer({ min: 0, max: 9 }).map(String));
const path = fc.tuple(fc.constantFrom("", "", "."), ident, fc.array(segment, { maxLength: 3 }))
  .map(([lead, head, rest]) => lead + [head, ...rest].join("."));
const arg = fc.oneof(
  fc.integer({ min: -99, max: 99 }).map(String),
  fc.double({ min: -9, max: 9, noNaN: true, noDefaultInfinity: true }).map((n) => String(Math.round(n * 100) / 100)),
  fc.constantFrom("true", "false", "null"),
  ident,
  fc.stringMatching(/^[a-z :;,|]{0,4}$/).map((s) => `'${s}'`),
  fc.stringMatching(/^[a-z :;,|]{0,4}$/).map((s) => `"${s}"`),
);
const filter = fc.oneof(
  ident.map((n) => `|${n}`),
  fc.tuple(ident, fc.array(arg, { maxLength: 3 }), ws).map(([n, a, s]) => `|${n}(${a.join("," + s)})`),
);
const prop = fc.oneof(
  fc.constantFrom("textContent", "value", "checked", "valueAsNumber", "title", "disabled", "radio", "checkbox", "...", "onclick", "oninput", "onsubmit"),
  ident.map((n) => `class.${n}`), ident.map((n) => `attr.data-${n}`), ident.map((n) => `style.${n}`),
  ident.map((n) => `eventToken.${n}`), ident.map((n) => `on${n}`),
);
const modifiers = fc.subarray(["prevent", "stop", "ro", "onchange", "init=element", "init=state", "sync=connect", "direct"], { maxLength: 3 });
const binding = fc.oneof(
  { weight: 6, arbitrary: fc.tuple(prop, modifiers, fc.array(filter, { maxLength: 2 }), ws, ws, path, fc.array(filter, { maxLength: 3 }))
    .map(([p, m, inF, s1, s2, pa, outF]) => `${p}${m.length ? "#" + m.join(",") : ""}${inF.join("")}${s1}:${s2}${pa}${outF.join("")}`) },
  { weight: 1, arbitrary: fc.tuple(fc.constantFrom("for", "if", "elseif"), ws, path).map(([d, s, pa]) => `${d}:${s}${pa}`) },
  { weight: 1, arbitrary: fc.tuple(ident, path).map(([n, pa]) => `command.${n}: $command.${pa.replace(/^\./, "")}`) },
  { weight: 1, arbitrary: fc.constant("else:") },
);
const text = fc.tuple(fc.array(fc.tuple(ws, binding, ws), { minLength: 1, maxLength: 3 }), fc.boolean())
  .map(([bs, trailing]) => bs.map(([a, b, c]) => a + b + c).join(";") + (trailing ? ";" : ""));
const junk = fc.stringMatching(/^[a-z.:;|#,()'"*$ 0-9=\-]{0,24}$/);

function agree(parseOld: (t: string) => unknown, parseNew: (t: string) => unknown, t: string): void {
  if (APPROVED.some((a) => a.covers(t))) return;
  const o = outcome(parseOld, t);
  const n = outcome(parseNew, t);
  expect({ text: t, ...n }).toEqual({ text: t, ...o });
}

describe("data-wcs のパーサ: 4.0 と凍結した 3.5.4 の差分（property、§2.5 (b)）", () => {
  it("文法から作った束縛の文字列で、両方が同じ結果を返す（どちらかだけが拒むものも無い）", () => {
    fc.assert(fc.property(text, (t) => {
      neo.clearParserCaches();
      old.clearParserCaches();
      agree(old.parseBindTextsForElement, neo.parseBindTextsForElement, t);
    }), { numRuns: 1000 });
  });

  it("文法の文字だけのでたらめな文字列でも、受け付けるか拒むかが一致し、受け付けたら同じ結果", () => {
    fc.assert(fc.property(junk, (t) => {
      agree(old.parseBindTextsForElement, neo.parseBindTextsForElement, t);
    }), { numRuns: 1000 });
  });

  it("埋め込みの束縛（{{ }} とコメントの形）も同じ", () => {
    fc.assert(fc.property(fc.tuple(ws, path, fc.array(filter, { maxLength: 3 }), ws).map(([a, p, f, b]) => a + p + f.join("") + b), (t) => {
      agree(old.parseBindTextForEmbeddedNode, neo.parseBindTextForEmbeddedNode, t);
    }), { numRuns: 500 });
  });
});
