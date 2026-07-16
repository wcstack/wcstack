import { describe, it, expect } from "vitest";
import { parseJsonWithSpans, pointer } from "../src/core/sidecar/jsonSource.js";
import {
  DiagnosticContext,
  resolveSchemaPath,
  validateSchemaSubset,
} from "../src/core/sidecar/schemaSubset.js";
import { loadManifest, resolvePackageContracts } from "../src/core/sidecar/loader.js";
import { checkDrift } from "../src/core/sidecar/drift.js";
import { validateManifestArtifact, validateManifestSet } from "../src/core/sidecar/validate.js";
import { WcsDiagnosticCode } from "../src/core/diagnostics.js";
import type { JsonSchemaNode, LiveBindableDeclaration } from "../src/core/sidecar/types.js";

function codes(diags: readonly { code: string }[]): string[] {
  return diags.map((d) => d.code);
}

describe("jsonSource — position-tracking parser", () => {
  it("値とキーの span を JSON pointer で索ける", () => {
    const text = '{ "a": { "b": [1, 2] } }';
    const parsed = parseJsonWithSpans(text);
    expect(parsed.error).toBeNull();
    expect(parsed.value).toEqual({ a: { b: [1, 2] } });
    const bSpan = parsed.spans.get(pointer("a", "b"))!;
    expect(text.slice(bSpan.start, bSpan.end)).toBe("[1, 2]");
    const item1 = parsed.spans.get(pointer("a", "b", 1))!;
    expect(text.slice(item1.start, item1.end)).toBe("2");
    // key span
    expect(text.slice(bSpan.keyStart!, bSpan.keyEnd!)).toBe('"b"');
  });

  it("壊れた JSON はエラー offset を返す", () => {
    const parsed = parseJsonWithSpans('{ "a": }');
    expect(parsed.error).not.toBeNull();
    expect(parsed.value).toBeUndefined();
    expect(parsed.error!.offset).toBeGreaterThan(0);
  });

  it("エスケープ・数値・literal・trailing を扱う", () => {
    expect(parseJsonWithSpans('"a\\n\\u0041"').value).toBe("a\nA");
    expect(parseJsonWithSpans("-12.5e3").value).toBe(-12500);
    expect(parseJsonWithSpans("true").value).toBe(true);
    expect(parseJsonWithSpans("false").value).toBe(false);
    expect(parseJsonWithSpans("null").value).toBeNull();
    expect(parseJsonWithSpans("[]").value).toEqual([]);
    expect(parseJsonWithSpans("{}").value).toEqual({});
    expect(parseJsonWithSpans("1 2").error).not.toBeNull(); // trailing
  });
});

describe("schemaSubset — subset validation", () => {
  function validate(schema: JsonSchemaNode, rootDefs: Record<string, JsonSchemaNode> = {}) {
    const text = JSON.stringify(schema);
    const ctx = new DiagnosticContext(parseJsonWithSpans(text).spans);
    validateSchemaSubset(schema, "", ctx, rootDefs);
    return ctx.diagnostics;
  }

  it("許可 keyword のみのスキーマは診断なし", () => {
    expect(validate({ type: "object", properties: { a: { type: "string" } }, required: ["a"] })).toEqual([]);
  });

  it("未知 keyword は unsupported(warning)", () => {
    const d = validate({ type: "string", pattern: "x", minLength: 2 } as JsonSchemaNode);
    expect(codes(d)).toEqual([WcsDiagnosticCode.ManifestUnknownKeyword, WcsDiagnosticCode.ManifestUnknownKeyword]);
    expect(d.every((x) => x.severity === "warning")).toBe(true);
  });

  it("external $ref は error", () => {
    const d = validate({ $ref: "https://example.com/x.json#/a" });
    expect(codes(d)).toEqual([WcsDiagnosticCode.ManifestExternalRef]);
    expect(d[0].severity).toBe("error");
  });

  it("未解決 local $ref は error", () => {
    const d = validate({ $ref: "#/$defs/Missing" }, {});
    expect(codes(d)).toEqual([WcsDiagnosticCode.ManifestRefUnresolved]);
  });

  it("$ref cycle を検出する(無限ループしない)", () => {
    const defs: Record<string, JsonSchemaNode> = {
      A: { $ref: "#/$defs/B" },
      B: { $ref: "#/$defs/A" },
    };
    const d = validate({ $ref: "#/$defs/A", $defs: defs }, defs);
    expect(codes(d)).toContain(WcsDiagnosticCode.ManifestRefCycle);
  });

  it("anyOf / items / $defs 配下も再帰検証する", () => {
    const d = validate({
      anyOf: [{ type: "string" }, { type: "number", format: "int" } as JsonSchemaNode],
      items: { type: "boolean", extra: 1 } as JsonSchemaNode,
    });
    expect(codes(d)).toEqual([WcsDiagnosticCode.ManifestUnknownKeyword, WcsDiagnosticCode.ManifestUnknownKeyword]);
  });
});

describe("schemaSubset — path resolution (論点6)", () => {
  const root: JsonSchemaNode = {
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: {
          name: { type: "string" },
          roles: { type: "array", items: { type: "string" } },
        },
      },
      items: {
        type: "array",
        items: { type: "object", properties: { id: { type: "number" }, label: { type: "string" } } },
      },
      maybe: {
        anyOf: [
          { type: "object", properties: { x: { type: "string" } } },
          { type: "null" },
        ],
      },
    },
    $defs: {
      Node: { type: "object", properties: { child: { $ref: "#/$defs/Node" }, leaf: { type: "string" } } },
    },
  };
  const defs = root.$defs!;

  it("nested property を解決する", () => {
    const r = resolveSchemaPath(root, defs, ["user", "name"]);
    expect(r.kind).toBe("resolved");
    expect(r.kind === "resolved" && r.schema.type).toBe("string");
  });

  it("array wildcard(list context)を items に解決する", () => {
    const r = resolveSchemaPath(root, defs, ["items", "*", "label"]);
    expect(r.kind === "resolved" && r.schema.type).toBe("string");
  });

  it("array の length は number", () => {
    const r = resolveSchemaPath(root, defs, ["items", "length"]);
    expect(r.kind === "resolved" && r.schema.type).toBe("number");
  });

  it("anyOf union の枝をまたいで property を解決する", () => {
    const r = resolveSchemaPath(root, defs, ["maybe", "x"]);
    expect(r.kind === "resolved" && r.schema.type).toBe("string");
  });

  it("object に存在しない member は nonexistent", () => {
    const r = resolveSchemaPath(root, defs, ["user", "nope"]);
    expect(r.kind).toBe("nonexistent");
    expect(r.kind === "nonexistent" && r.segment).toBe("nope");
    expect(r.kind === "nonexistent" && r.depth).toBe(1);
  });

  it("非 object への wildcard / 型情報の無い segment は unknown(runtime を妨げない)", () => {
    expect(resolveSchemaPath(root, defs, ["user", "name", "*"]).kind).toBe("unknown");
    expect(resolveSchemaPath({ type: "string" }, {}, ["anything"]).kind).toBe("unknown");
  });

  it("nested list($defs 再帰)を辿れる", () => {
    const r = resolveSchemaPath(root, defs, ["items"]); // resolves to the array schema
    expect(r.kind).toBe("resolved");
    const r2 = resolveSchemaPath({ $ref: "#/$defs/Node" }, defs, ["child", "child", "leaf"]);
    expect(r2.kind === "resolved" && r2.schema.type).toBe("string");
  });

  it("external / cyclic $ref は ref-error", () => {
    const cyc: Record<string, JsonSchemaNode> = { A: { $ref: "#/$defs/A" } };
    expect(resolveSchemaPath({ $ref: "#/$defs/A", $defs: cyc }, cyc, ["x"]).kind).toBe("ref-error");
    expect(resolveSchemaPath({ $ref: "http://x/y#/z" }, {}, ["x"]).kind).toBe("ref-error");
  });
});

describe("loader — envelope validation", () => {
  function load(text: string) {
    return loadManifest({ text, source: "m.json" }).ctx.diagnostics;
  }
  it("正しい envelope は診断なし", () => {
    expect(load('{ "schemaVersion": 1, "kind": "package" }')).toEqual([]);
  });
  it("壊れた JSON は broken", () => {
    expect(codes(load('{ "schemaVersion": }'))).toEqual([WcsDiagnosticCode.ManifestBroken]);
  });
  it("root が object でないと broken", () => {
    expect(codes(load("[1,2]"))).toEqual([WcsDiagnosticCode.ManifestBroken]);
  });
  it("schemaVersion 欠落 / 非整数 / 未対応 major を診断する", () => {
    expect(codes(load('{ "kind": "package" }'))).toEqual([WcsDiagnosticCode.ManifestSchemaVersion]);
    expect(codes(load('{ "schemaVersion": 1.5, "kind": "package" }'))).toEqual([WcsDiagnosticCode.ManifestSchemaVersion]);
    expect(codes(load('{ "schemaVersion": 99, "kind": "package" }'))).toEqual([WcsDiagnosticCode.ManifestSchemaVersion]);
  });
  it("kind 不正 / 欠落を診断する", () => {
    expect(codes(load('{ "schemaVersion": 1, "kind": "widget" }'))).toEqual([WcsDiagnosticCode.ManifestKindInvalid]);
    expect(codes(load('{ "schemaVersion": 1 }'))).toEqual([WcsDiagnosticCode.ManifestKindInvalid]);
  });
  it("namespace version 不一致は warning", () => {
    const d = load('{ "schemaVersion": 1, "kind": "package", "manifestExtensions": { "wcstack.types": { "version": 9, "components": {} } } }');
    expect(codes(d)).toEqual([WcsDiagnosticCode.ManifestNamespaceVersion]);
    expect(d[0].severity).toBe("warning");
  });
});

describe("loader — collision & override", () => {
  function pkg(source: string, tag: string, override = false) {
    const component = override ? { override: true, observables: {} } : { observables: {} };
    return loadManifest({
      source,
      text: JSON.stringify({
        schemaVersion: 1,
        kind: "package",
        manifestExtensions: { "wcstack.types": { version: 1, components: { [tag]: component } } },
      }),
    });
  }

  it("同名 tag の二重定義は衝突エラーで後勝ちにしない(unknown 化)", () => {
    const resolved = resolvePackageContracts([pkg("a.json", "wcs-fetch"), pkg("b.json", "wcs-fetch")]);
    expect(resolved.tags.has("wcs-fetch")).toBe(false); // 衝突 → 契約なし
    const all = [...resolved.diagnosticsBySource.values()].flat();
    expect(codes(all)).toEqual([WcsDiagnosticCode.ManifestTagCollision]);
  });

  it("override:true は明示 override として info(衝突にしない)", () => {
    const resolved = resolvePackageContracts([pkg("a.json", "wcs-fetch"), pkg("b.json", "wcs-fetch", true)]);
    expect(resolved.tags.get("wcs-fetch")?.source).toBe("a.json"); // 元契約は残る
    const all = [...resolved.diagnosticsBySource.values()].flat();
    expect(codes(all)).toEqual([WcsDiagnosticCode.ManifestOverride]);
  });

  it("衝突しない tag は解決される", () => {
    const resolved = resolvePackageContracts([pkg("a.json", "wcs-fetch"), pkg("b.json", "wcs-ws")]);
    expect(resolved.tags.get("wcs-fetch")?.source).toBe("a.json");
    expect(resolved.tags.get("wcs-ws")?.source).toBe("b.json");
    expect([...resolved.diagnosticsBySource.values()].flat()).toEqual([]);
  });
});

describe("drift — sidecar vs live declaration", () => {
  const live: LiveBindableDeclaration = {
    tag: "wcs-fetch",
    properties: [{ name: "value", event: "wcs-fetch:response" }, { name: "loading", event: "wcs-fetch:loading-changed" }],
    inputs: [{ name: "url" }],
    commands: [{ name: "fetch" }],
  };
  function drift(component: any) {
    const ctx = new DiagnosticContext(new Map());
    checkDrift("wcs-fetch", component, live, ctx);
    return ctx.diagnostics;
  }

  it("live と一致する sidecar は drift なし", () => {
    expect(drift({
      observables: { value: { event: "wcs-fetch:response" }, loading: { event: "wcs-fetch:loading-changed" } },
      inputs: { url: {} },
      commands: { fetch: {} },
    })).toEqual([]);
  });

  it("実行時宣言に無い member は drift error", () => {
    expect(codes(drift({ observables: { ghost: { event: "x" } } }))).toEqual([WcsDiagnosticCode.DriftMissingMember]);
    expect(codes(drift({ inputs: { ghostInput: {} } }))).toEqual([WcsDiagnosticCode.DriftMissingMember]);
    expect(codes(drift({ commands: { ghostCmd: {} } }))).toEqual([WcsDiagnosticCode.DriftMissingMember]);
  });

  it("event 名の不一致は drift error", () => {
    expect(codes(drift({ observables: { value: { event: "wcs-fetch:WRONG" } } }))).toEqual([WcsDiagnosticCode.DriftEventMismatch]);
  });
});

describe("validate — integrated artifact + set", () => {
  const pkgText = JSON.stringify({
    schemaVersion: 1,
    kind: "package",
    manifestExtensions: {
      "wcstack.types": {
        version: 1,
        components: {
          "wcs-fetch": {
            observables: { response: { event: "wcs-fetch:response", schema: { type: ["object", "null"] } } },
            inputs: { url: { schema: { type: "string", pattern: "x" } } },
          },
        },
      },
    },
  });

  it("単一 artifact の schema subset 違反(未知 keyword)を検出する", () => {
    const d = validateManifestArtifact({ text: pkgText, source: "pkg.json" });
    expect(codes(d)).toEqual([WcsDiagnosticCode.ManifestUnknownKeyword]); // pattern
  });

  it("複数 artifact + live 宣言で衝突と drift を統合検出する", () => {
    const live = new Map<string, LiveBindableDeclaration>([
      ["wcs-fetch", { tag: "wcs-fetch", properties: [{ name: "response", event: "wcs-fetch:response" }], inputs: [] }],
    ]);
    const dupText = JSON.stringify({
      schemaVersion: 1,
      kind: "package",
      manifestExtensions: { "wcstack.types": { version: 1, components: { "wcs-fetch": { observables: {} } } } },
    });
    const result = validateManifestSet({
      artifacts: [
        { text: pkgText, source: "a.json" },
        { text: dupText, source: "b.json" },
      ],
      liveDeclarations: live,
    });
    const all = codes(result.diagnostics);
    // pattern(unknown keyword) + url が live に無い(drift) + tag 衝突
    expect(all).toContain(WcsDiagnosticCode.ManifestUnknownKeyword);
    expect(all).toContain(WcsDiagnosticCode.DriftMissingMember);
    expect(all).toContain(WcsDiagnosticCode.ManifestTagCollision);
    // 衝突したので tag 契約は解決されない
    expect(result.resolvedTags.has("wcs-fetch")).toBe(false);
    // per-artifact 診断が source ごとに分かれている
    expect(result.byArtifact.get("a.json")).toBeDefined();
    expect(result.byArtifact.get("b.json")).toBeDefined();
  });
});
