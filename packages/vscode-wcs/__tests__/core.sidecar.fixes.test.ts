import { describe, it, expect } from "vitest";
import { parseJsonWithSpans } from "../src/core/sidecar/jsonSource.js";
import {
  DiagnosticContext,
  resolveSchemaPath,
  validateSchemaSubset,
} from "../src/core/sidecar/schemaSubset.js";
import { loadManifest, resolvePackageContracts } from "../src/core/sidecar/loader.js";
import { validateManifestSet } from "../src/core/sidecar/validate.js";
import { WcsDiagnosticCode } from "../src/core/diagnostics.js";
import { createPositionMapper } from "../src/core/offsetToPosition.js";
import { parseArgs } from "../src/cli.js";
import { validateDocument } from "../src/core/validateDocument.js";
import { runValidation } from "../src/core/cli/runValidation.js";
import type { JsonSchemaNode } from "../src/core/sidecar/types.js";

function codes(diags: readonly { code: string }[]): string[] {
  return diags.map((d) => d.code);
}
function validate(schema: JsonSchemaNode, rootDefs: Record<string, JsonSchemaNode> = {}) {
  const ctx = new DiagnosticContext(parseJsonWithSpans(JSON.stringify(schema)).spans);
  validateSchemaSubset(schema, "", ctx, rootDefs);
  return ctx.diagnostics;
}

describe("fix: derefUnion shared $ref across anyOf branches (high)", () => {
  it("兄弟 anyOf 枝が同じ $ref を指しても cycle 扱いせず解決する", () => {
    const defs = { A: { type: "string" } as JsonSchemaNode };
    const root: JsonSchemaNode = { anyOf: [{ $ref: "#/$defs/A" }, { $ref: "#/$defs/A" }] };
    const r = resolveSchemaPath(root, defs, []);
    expect(r.kind).toBe("resolved");
  });

  it("diamond(anyOf:[A,B], A→Base, B→Base)を解決できる", () => {
    const defs: Record<string, JsonSchemaNode> = {
      Base: { type: "object", properties: { x: { type: "string" } } },
      Cat: { $ref: "#/$defs/Base" },
      Dog: { $ref: "#/$defs/Base" },
    };
    const root: JsonSchemaNode = { anyOf: [{ $ref: "#/$defs/Cat" }, { $ref: "#/$defs/Dog" }] };
    const r = resolveSchemaPath(root, defs, ["x"]);
    expect(r.kind === "resolved" && r.schema.type).toBe("string");
  });

  it("本物の自己 cycle は依然 ref-error", () => {
    const defs: Record<string, JsonSchemaNode> = { A: { $ref: "#/$defs/A" } };
    expect(resolveSchemaPath({ $ref: "#/$defs/A", $defs: defs }, defs, ["x"]).kind).toBe("ref-error");
  });
});

describe("fix: no duplicate diagnostic from re-walking $ref targets (high)", () => {
  it("$def 内の未知 keyword は 1 回だけ、正しい pointer で報告される", () => {
    const schema: JsonSchemaNode = {
      properties: { node: { $ref: "#/$defs/N" } },
      $defs: { N: { type: "string", description: "x" } as JsonSchemaNode },
    };
    const d = validate(schema, { N: { type: "string", description: "x" } as JsonSchemaNode });
    const unknown = d.filter((x) => x.code === WcsDiagnosticCode.ManifestUnknownKeyword);
    expect(unknown).toHaveLength(1);
    // offset 0 の偽 range(pointer 不在フォールバック)ではなく、実 span を指す
    expect(unknown[0].start).toBeGreaterThan(0);
  });

  it("循環参照はまだ検出される", () => {
    const defs: Record<string, JsonSchemaNode> = { A: { $ref: "#/$defs/B" }, B: { $ref: "#/$defs/A" } };
    const d = validate({ $ref: "#/$defs/A", $defs: defs }, defs);
    expect(codes(d)).toContain(WcsDiagnosticCode.ManifestRefCycle);
  });
});

describe("fix: malformed schema shapes do not throw (medium)", () => {
  it("properties/$defs/items/anyOf が不正型でも例外なくスキップする", () => {
    expect(() => validate({ properties: null } as unknown as JsonSchemaNode)).not.toThrow();
    expect(() => validate({ $defs: 3 } as unknown as JsonSchemaNode)).not.toThrow();
    expect(() => validate({ items: "x" } as unknown as JsonSchemaNode)).not.toThrow();
    expect(() => validate({ anyOf: {} } as unknown as JsonSchemaNode)).not.toThrow();
    // path 解決側も落ちない
    expect(() => resolveSchemaPath({ properties: null } as unknown as JsonSchemaNode, {}, ["a"])).not.toThrow();
  });
});

describe("fix: schemaVersion present-but-wrong-type message (low)", () => {
  it("非整数 schemaVersion は missing でなく型エラーとして schemaVersion を指す", () => {
    const text = '{ "schemaVersion": "1", "kind": "package" }';
    const d = loadManifest({ text, source: "m.json" }).ctx.diagnostics;
    expect(codes(d)).toEqual([WcsDiagnosticCode.ManifestSchemaVersion]);
    expect(d[0].message).toMatch(/must be an integer/);
    expect(d[0].start).toBeGreaterThan(0); // whole-doc(0)でなく該当 span
  });
});

describe("fix: filter collision + override purge (low)", () => {
  function appFilters(source: string, names: string[]) {
    const filters: Record<string, unknown> = {};
    for (const n of names) filters[n] = {};
    return loadManifest({ source, text: JSON.stringify({ schemaVersion: 1, kind: "application", manifestExtensions: { "wcstack.application": { version: 1, filters } } }) });
  }
  it("同名 filter の二重定義は collision(§5-3)", () => {
    const resolved = resolvePackageContracts([appFilters("a.json", ["fmt"]), appFilters("b.json", ["fmt"])]);
    const all = [...resolved.diagnosticsBySource.values()].flat();
    expect(codes(all)).toEqual([WcsDiagnosticCode.ManifestFilterCollision]);
  });

  it("collision で撤回された tag の override info は残さない", () => {
    function pkg(source: string, override = false) {
      const component = override ? { override: true, observables: {} } : { observables: {} };
      return loadManifest({ source, text: JSON.stringify({ schemaVersion: 1, kind: "package", manifestExtensions: { "wcstack.types": { version: 1, components: { "wcs-x": component } } } }) });
    }
    // a: winner, b: override(info), c: collision(撤回)
    const resolved = resolvePackageContracts([pkg("a.json"), pkg("b.json", true), pkg("c.json")]);
    const all = [...resolved.diagnosticsBySource.values()].flat();
    // 撤回されたので override info は purge、collision error のみ残る
    expect(codes(all)).toContain(WcsDiagnosticCode.ManifestTagCollision);
    expect(codes(all)).not.toContain(WcsDiagnosticCode.ManifestOverride);
    expect(resolved.tags.has("wcs-x")).toBe(false);
  });
});

describe("fix: offsetToPosition handles CR line endings (low)", () => {
  it("\\r\\n と単独 \\r を改行として扱う", () => {
    const map = createPositionMapper("a\r\nb\rc");
    expect(map(0)).toEqual({ line: 1, column: 1 }); // a
    expect(map(3)).toEqual({ line: 2, column: 1 }); // b (after \r\n)
    expect(map(5)).toEqual({ line: 3, column: 1 }); // c (after lone \r)
  });
});

describe("fix: CLI config flags preserve parity (medium)", () => {
  it("parseArgs は --attr / --state-tag を options に、残りを files に分ける", () => {
    const { options, files } = parseArgs(["--attr=x-bind", "--state-tag=x-state", "a.html", "b.manifest.json"]);
    expect(options).toEqual({ bindAttribute: "x-bind", stateTagName: "x-state" });
    expect(files).toEqual(["a.html", "b.manifest.json"]);
  });

  it("カスタム属性下でも IDE(validateDocument)と CLI(runValidation)が一致する", () => {
    const html = `<x-state json='{"a":1}'></x-state>\n<span x-bind="textContent: ghost"></span>`;
    const opts = { bindAttribute: "x-bind", stateTagName: "x-state" };
    const ide = validateDocument(html, opts);
    const cli = runValidation([{ source: "p.html", text: html, kind: "html" }], opts).diagnosticsBySource.get("p.html");
    expect(cli).toEqual(ide);
    expect(ide.length).toBeGreaterThan(0);
  });
});
