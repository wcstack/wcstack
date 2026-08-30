import { describe, it, expect } from "vitest";
import { buildManifest, readStateSchema, stableStringify, compareStateSchema, APPLICATION_NAMESPACE } from "../src/exports";

const schema = { type: "object", properties: { count: { type: "number" } }, required: ["count"] };

describe("buildManifest — envelope と states の組み立て", () => {
  it("新規: envelope を補い、1 state を載せる", () => {
    const m = buildManifest("default", schema);
    expect(m).toEqual({
      schemaVersion: 1,
      kind: "application",
      manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 1, states: { default: { stateSchema: schema } } } },
    });
  });

  it("--merge: 他 state / filters / listContexts / 未知キーを保持し、該当 state だけ置き換える（手書きは残らない）", () => {
    const existing = {
      schemaVersion: 1,
      kind: "application",
      note: "keep me",
      manifestExtensions: {
        [APPLICATION_NAMESPACE]: {
          version: 1,
          states: {
            default: { stateSchema: { type: "object", properties: { handWritten: { type: "string" } } } },
            other: { stateSchema: { type: "object", properties: { x: { type: "number" } } } },
          },
          filters: { money: { input: { type: "number" }, output: { type: "string" } } },
          listContexts: ["users"],
        },
        "vendor.extra": { version: 1 },
      },
    };
    const m = buildManifest("default", schema, existing);
    const ns = m.manifestExtensions[APPLICATION_NAMESPACE];
    expect(ns.states!.default.stateSchema).toEqual(schema);
    expect(ns.states!.other.stateSchema.properties).toHaveProperty("x");
    expect(ns.filters).toEqual(existing.manifestExtensions[APPLICATION_NAMESPACE].filters);
    expect(ns.listContexts).toEqual(["users"]);
    expect(m.manifestExtensions["vendor.extra"]).toEqual({ version: 1 });
    expect(m.note).toBe("keep me");
    // 入力は変異しない
    expect(existing.manifestExtensions[APPLICATION_NAMESPACE].states.default.stateSchema.properties).toHaveProperty("handWritten");
  });

  it("--merge: 既存が壊れた形（配列・非オブジェクト・kind 違い）でも envelope を作り直す", () => {
    expect(buildManifest("default", schema, [1, 2]).kind).toBe("application");
    expect(buildManifest("default", schema, "str").schemaVersion).toBe(1);
    const fromPackage = buildManifest("default", schema, { schemaVersion: 1, kind: "package", manifestExtensions: { "wcstack.types": { version: 1, components: {} } } });
    expect(fromPackage.kind).toBe("application");
    expect(fromPackage.manifestExtensions["wcstack.types"]).toBeDefined();
    const weirdNs = buildManifest("s", schema, { manifestExtensions: { [APPLICATION_NAMESPACE]: "nope" } });
    expect(weirdNs.manifestExtensions[APPLICATION_NAMESPACE].states!.s.stateSchema).toEqual(schema);
    const weirdStates = buildManifest("s", schema, { manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 1, states: [] } } });
    expect(weirdStates.manifestExtensions[APPLICATION_NAMESPACE].states!.s.stateSchema).toEqual(schema);
  });
});

describe("readStateSchema / stableStringify", () => {
  it("欠けた階層のどこで止まっても undefined", () => {
    expect(readStateSchema(null, "default")).toBeUndefined();
    expect(readStateSchema({}, "default")).toBeUndefined();
    expect(readStateSchema({ manifestExtensions: null }, "default")).toBeUndefined();
    expect(readStateSchema({ manifestExtensions: {} }, "default")).toBeUndefined();
    expect(readStateSchema({ manifestExtensions: { [APPLICATION_NAMESPACE]: { states: null } } }, "default")).toBeUndefined();
    expect(readStateSchema({ manifestExtensions: { [APPLICATION_NAMESPACE]: { states: { other: {} } } } }, "default")).toBeUndefined();
    expect(readStateSchema({ manifestExtensions: { [APPLICATION_NAMESPACE]: { states: { default: null } } } }, "default")).toBeUndefined();
    expect(readStateSchema(buildManifest("default", schema), "default")).toEqual(schema);
  });

  it("キー順に依存しない正規形", () => {
    expect(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe('{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(stableStringify(null)).toBe("null");
  });
});

describe("compareStateSchema — drift 検出（D9）", () => {
  const text = JSON.stringify(buildManifest("default", schema));

  it("同じ（キー順違いは同じ）", () => {
    expect(compareStateSchema(text, "default", schema)).toEqual({ kind: "same" });
    const reordered = { required: ["count"], properties: { count: { type: "number" } }, type: "object" };
    expect(compareStateSchema(text, "default", reordered)).toEqual({ kind: "same" });
  });

  it("差分は JSON pointer で + / - / ~ に分類する（配列と空オブジェクトは葉として比較）", () => {
    const generated = {
      type: "object",
      properties: { count: { type: "string" }, name: { type: "string" }, meta: {} },
      required: ["count", "name"],
    };
    const result = compareStateSchema(text, "default", generated);
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
    const shrunk = compareStateSchema(text, "default", { type: "object" });
    expect(shrunk.kind === "differs" && shrunk.changes).toEqual(["- /properties/count/type", "- /required"]);
  });

  it("開いた {} との比較はルート 1 点の差分になる", () => {
    const result = compareStateSchema(text, "default", {});
    expect(result.kind === "differs" && result.changes).toEqual(["+ /", "- /properties/count/type", "- /required", "- /type"]);
  });

  it("state が無い / JSON が壊れている", () => {
    expect(compareStateSchema(text, "other", schema)).toEqual({ kind: "missing-state" });
    expect(compareStateSchema("{ oops", "default", schema).kind).toBe("broken");
  });
});
