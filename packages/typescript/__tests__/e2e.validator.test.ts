import { describe, it, expect, afterAll } from "vitest";
import { generateStateSchema, loadSchemaCore, buildManifest } from "../src/exports";
import { makeTempDir } from "./helpers";

/**
 * End-to-end: the schema this package generates must be what the validator core
 * (vscode-wcs, via dist/schema-core.cjs) consumes — `users.*.name` resolves, the
 * typo is `wcs/path-nonexistent`, and the manifest passes the self-check.
 * (実測 5 の fixture: `[] as {name:string}[]` は正規表現アナライザでは読めない。)
 */
const tmp = makeTempDir("wcs-schema-e2e-");
afterAll(() => tmp.cleanup());

describe("生成した stateSchema を検証器に通す", () => {
  const html = `<wcs-state src="./state.ts"></wcs-state>
<p data-wcs="textContent: coutn"></p>
<template data-wcs="for: users"><li data-wcs="textContent: .name"></li></template>
<p>{{ users.length }}</p>
<p data-wcs="textContent: when.getTime"></p>
<template data-wcs="for: title"></template>`;

  it("偽警告が消え、typo だけが error になる。Date（{}）の下は沈黙、for: に string は type-mismatch", () => {
    const file = tmp.write("state.ts", `export default {
  count: 0,
  title: "t",
  when: new Date(),
  users: [] as { name: string }[],
};`);
    const { schema } = generateStateSchema(file);
    const core = loadSchemaCore();

    const manifestText = JSON.stringify(buildManifest(null, schema));
    expect(core.validateManifestArtifact({ text: manifestText, source: "wcstack.manifest.json" })).toEqual([]);

    const diags = core.validateDocument(html, { applicationSchema: schema });
    const codes = diags.map((d) => [d.code, html.slice(d.start, d.end)]);
    expect(codes).toContainEqual([core.WcsDiagnosticCode.PathNonexistent, "coutn"]);
    expect(codes).toContainEqual([core.WcsDiagnosticCode.PathTypeMismatch, "title"]);
    expect(codes.filter(([c]) => c === core.WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
    expect(codes.some(([, text]) => text === ".name" || text === "users.length" || text === "when.getTime")).toBe(false);
  });

  it("インデックスシグネチャの型（数値キー・文字列キー）の下は error にせず、数値キーを書いたオブジェクトの打ち間違いは error", () => {
    const file = tmp.write("index-signature/state.ts", `interface Sale { total: number }
interface ByYear { [year: number]: Sale }
export default {
  idx: {} as ByYear,
  inline: {} as { [key: string]: Sale },
  rec: {} as Record<number, Sale>,
  fixed: { 2024: { total: 0 } },
};`);
    const { schema } = generateStateSchema(file);
    const core = loadSchemaCore();
    const page = `<wcs-state src="./state.ts"></wcs-state>
<p data-wcs="textContent: idx.2024.total"></p>
<p data-wcs="textContent: inline.foo.total"></p>
<p data-wcs="textContent: rec.2024.total"></p>
<p data-wcs="textContent: fixed.2024.total"></p>
<p data-wcs="textContent: fixed.2024.totl"></p>
<p data-wcs="textContent: fixed.2025.total"></p>`;
    const diags = core.validateDocument(page, { applicationSchema: schema });
    expect(diags.filter((d) => d.severity === "error").map((d) => [d.code, page.slice(d.start, d.end)])).toEqual([
      [core.WcsDiagnosticCode.PathNonexistent, "fixed.2024.totl"],
      [core.WcsDiagnosticCode.PathNonexistent, "fixed.2025.total"],
    ]);
  });

  it("schema 無し（従来）では同じ HTML が warning のみ", () => {
    const core = loadSchemaCore();
    const diags = core.validateDocument(html, {
      fileReader: (p) => (p.endsWith("state.ts") ? `export default { count: 0, title: "t", when: new Date(), users: [] as { name: string }[] };` : undefined),
    });
    expect(diags.some((d) => d.code === core.WcsDiagnosticCode.PathNonexistent)).toBe(false);
    expect(diags.some((d) => d.code === core.WcsDiagnosticCode.BindingPathMissing)).toBe(true);
  });
});
