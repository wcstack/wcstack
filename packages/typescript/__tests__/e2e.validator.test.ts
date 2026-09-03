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

  it("schema 無し（従来）では同じ HTML が warning のみ", () => {
    const core = loadSchemaCore();
    const diags = core.validateDocument(html, {
      fileReader: (p) => (p.endsWith("state.ts") ? `export default { count: 0, title: "t", when: new Date(), users: [] as { name: string }[] };` : undefined),
    });
    expect(diags.some((d) => d.code === core.WcsDiagnosticCode.PathNonexistent)).toBe(false);
    expect(diags.some((d) => d.code === core.WcsDiagnosticCode.BindingPathMissing)).toBe(true);
  });
});
