import { describe, it, expect } from "vitest";
import { buildManifest, readStateSchema, isV1Manifest, stableStringify, compareStateSchema, APPLICATION_NAMESPACE } from "../src/exports";

const schema = { type: "object", properties: { count: { type: "number" } }, required: ["count"] };

describe("buildManifest — envelope と stateSchema の組み立て（v2: 単一ツリー）", () => {
  it("新規: envelope を補い、単一の stateSchema を載せる", () => {
    const m = buildManifest(null, schema);
    expect(m).toEqual({
      schemaVersion: 2,
      kind: "application",
      manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 2, stateSchema: schema } },
    });
  });

  it("--merge: filters / listContexts / 未知キーを保持し、stateSchema だけ置き換える（手書きは残らない）", () => {
    const existing = {
      schemaVersion: 2,
      kind: "application",
      note: "keep me",
      manifestExtensions: {
        [APPLICATION_NAMESPACE]: {
          version: 2,
          stateSchema: { type: "object", properties: { handWritten: { type: "string" } } },
          filters: { money: { input: { type: "number" }, output: { type: "string" } } },
          listContexts: ["users"],
        },
        "vendor.extra": { version: 1 },
      },
    };
    const m = buildManifest(null, schema, existing);
    const ns = m.manifestExtensions[APPLICATION_NAMESPACE];
    expect(ns.stateSchema).toEqual(schema);
    expect(ns.filters).toEqual(existing.manifestExtensions[APPLICATION_NAMESPACE].filters);
    expect(ns.listContexts).toEqual(["users"]);
    expect(m.manifestExtensions["vendor.extra"]).toEqual({ version: 1 });
    expect(m.note).toBe("keep me");
    // 入力は変異しない
    expect((existing.manifestExtensions[APPLICATION_NAMESPACE].stateSchema.properties as Record<string, unknown>)).toHaveProperty("handWritten");
  });

  it("--mount=<path>: 既存 stateSchema の部分木として merge し、他の枝を保持する", () => {
    const existing = buildManifest(null, {
      type: "object",
      properties: { count: { type: "number" } },
    });
    const volume = { type: "object", properties: { t: { type: "object" } } };
    const m = buildManifest("i18n", volume, existing);
    const stored = m.manifestExtensions[APPLICATION_NAMESPACE].stateSchema as Record<string, any>;
    expect(stored.properties.count).toEqual({ type: "number" });
    expect(stored.properties.i18n).toEqual(volume);
  });

  it("--mount の深いパスは中間 object ノードを作る", () => {
    const volume = { type: "object", properties: { x: { type: "string" } } };
    const m = buildManifest("app.i18n", volume);
    const stored = m.manifestExtensions[APPLICATION_NAMESPACE].stateSchema as Record<string, any>;
    expect(stored.properties.app.type).toBe("object");
    expect(stored.properties.app.properties.i18n).toEqual(volume);
  });

  it("v1 の states は再生成で持ち越さない（schemaVersion も 2 へ）", () => {
    const v1 = {
      schemaVersion: 1,
      kind: "application",
      manifestExtensions: {
        [APPLICATION_NAMESPACE]: { version: 1, states: { default: { stateSchema: schema } } },
      },
    };
    const m = buildManifest(null, schema, v1);
    expect(m.schemaVersion).toBe(2);
    const ns = m.manifestExtensions[APPLICATION_NAMESPACE] as Record<string, unknown>;
    expect(ns.version).toBe(2);
    expect(ns.states).toBeUndefined();
    expect(ns.stateSchema).toEqual(schema);
  });

  it("--merge: 既存が壊れた形（配列・非オブジェクト・kind 違い）でも envelope を作り直す", () => {
    expect(buildManifest(null, schema, [1, 2]).kind).toBe("application");
    expect(buildManifest(null, schema, "str").schemaVersion).toBe(2);
    const fromPackage = buildManifest(null, schema, { schemaVersion: 2, kind: "package", manifestExtensions: { "wcstack.types": { version: 2, components: {} } } });
    expect(fromPackage.kind).toBe("application");
    expect(fromPackage.manifestExtensions["wcstack.types"]).toBeDefined();
    const weirdNs = buildManifest(null, schema, { manifestExtensions: { [APPLICATION_NAMESPACE]: "nope" } });
    expect(weirdNs.manifestExtensions[APPLICATION_NAMESPACE].stateSchema).toEqual(schema);
    const weirdSchema = buildManifest("s", schema, { manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 2, stateSchema: [] } } });
    const stored = weirdSchema.manifestExtensions[APPLICATION_NAMESPACE].stateSchema as Record<string, any>;
    expect(stored.properties.s).toEqual(schema);
  });
});

describe("readStateSchema / isV1Manifest / stableStringify", () => {
  it("欠けた階層のどこで止まっても undefined", () => {
    expect(readStateSchema(null)).toBeUndefined();
    expect(readStateSchema({})).toBeUndefined();
    expect(readStateSchema({ manifestExtensions: null })).toBeUndefined();
    expect(readStateSchema({ manifestExtensions: {} })).toBeUndefined();
    expect(readStateSchema({ manifestExtensions: { [APPLICATION_NAMESPACE]: null } })).toBeUndefined();
    expect(readStateSchema({ manifestExtensions: { [APPLICATION_NAMESPACE]: {} } })).toBeUndefined();
    expect(readStateSchema(buildManifest(null, schema))).toEqual(schema);
  });

  it("isV1Manifest は schemaVersion 1 と states 形を v1 と判定する", () => {
    expect(isV1Manifest({ schemaVersion: 1, kind: "application" })).toBe(true);
    expect(isV1Manifest({ schemaVersion: 2, manifestExtensions: { [APPLICATION_NAMESPACE]: { states: {} } } })).toBe(true);
    expect(isV1Manifest(buildManifest(null, schema))).toBe(false);
    expect(isV1Manifest(null)).toBe(false);
    expect(isV1Manifest({ manifestExtensions: null })).toBe(false);
  });

  it("キー順に依存しない正規形", () => {
    expect(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe('{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(stableStringify(null)).toBe("null");
  });
});

describe("compareStateSchema — drift 検出（D9）", () => {
  const text = JSON.stringify(buildManifest(null, schema));

  it("同じ（キー順違いは同じ）", () => {
    expect(compareStateSchema(text, null, schema)).toEqual({ kind: "same" });
    const reordered = { required: ["count"], properties: { count: { type: "number" } }, type: "object" };
    expect(compareStateSchema(text, null, reordered)).toEqual({ kind: "same" });
  });

  it("--mount は部分木を比較する", () => {
    const volume = { type: "object", properties: { t: { type: "object" } } };
    const mounted = JSON.stringify(buildManifest("i18n", volume, buildManifest(null, schema)));
    expect(compareStateSchema(mounted, "i18n", volume)).toEqual({ kind: "same" });
    expect(compareStateSchema(mounted, "i18n", schema).kind).toBe("differs");
    expect(compareStateSchema(mounted, "nope", volume)).toEqual({ kind: "missing-state" });
  });

  it("差分は JSON pointer で + / - / ~ に分類する（配列と空オブジェクトは葉として比較）", () => {
    const generated = {
      type: "object",
      properties: { count: { type: "string" }, name: { type: "string" }, meta: {} },
      required: ["count", "name"],
    };
    const result = compareStateSchema(text, null, generated);
    expect(result.kind).toBe("differs");
    if (result.kind !== "differs") return;
    // pointer 昇順（記号ではなく場所で並ぶ）
    expect(result.changes).toEqual([
      "~ /properties/count/type",
      "+ /properties/meta",
      "+ /properties/name/type",
      "~ /required",
    ]);
    // 逆向き（manifest にだけある）は `-`
    const shrunk = compareStateSchema(text, null, { type: "object" });
    expect(shrunk.kind === "differs" && shrunk.changes).toEqual(["- /properties/count/type", "- /required"]);
  });

  it("開いた {} との比較はルート 1 点の差分になる", () => {
    const result = compareStateSchema(text, null, {});
    expect(result.kind === "differs" && result.changes).toEqual(["+ /", "- /properties/count/type", "- /required", "- /type"]);
  });

  it("stateSchema が無い / v1 manifest / JSON が壊れている", () => {
    const empty = JSON.stringify({ schemaVersion: 2, kind: "application", manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 2 } } });
    expect(compareStateSchema(empty, null, schema)).toEqual({ kind: "missing-state" });
    const v1 = JSON.stringify({ schemaVersion: 1, kind: "application", manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 1, states: { default: { stateSchema: schema } } } } });
    expect(compareStateSchema(v1, null, schema)).toEqual({ kind: "v1-manifest" });
    expect(compareStateSchema("{ oops", null, schema).kind).toBe("broken");
  });
});
