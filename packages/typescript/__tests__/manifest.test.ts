import { describe, it, expect } from "vitest";
import { buildManifest, readStateSchema, readStateSource, sameStateSource, isV1Manifest, stableStringify, compareStateSchema, APPLICATION_NAMESPACE } from "../src/exports";

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

describe("stateSource — ルートの schema の元のファイル", () => {
  it("ルートの schema と一緒に書く。--merge は置き換え、渡さなければ古いものを消す（別のファイルの schema を指したままにしない）", () => {
    const fresh = buildManifest(null, schema, undefined, "src/state.ts");
    expect(fresh.manifestExtensions[APPLICATION_NAMESPACE].stateSource).toBe("src/state.ts");
    expect(readStateSource(fresh)).toBe("src/state.ts");
    const replaced = buildManifest(null, schema, fresh, "src/state/app.ts");
    expect(readStateSource(replaced)).toBe("src/state/app.ts");
    expect(readStateSource(buildManifest(null, schema, fresh))).toBeUndefined();
  });

  it("--mount はボリュームの schema なので stateSource をそのまま残し、新規なら書かない", () => {
    const root = buildManifest(null, schema, undefined, "src/state.ts");
    const volume = { type: "object", properties: { t: { type: "object" } } };
    expect(readStateSource(buildManifest("i18n", volume, root, "src/i18n.ts"))).toBe("src/state.ts");
    expect(readStateSource(buildManifest("i18n", volume, undefined, "src/i18n.ts"))).toBeUndefined();
  });

  it("readStateSource は文字列だけを返す", () => {
    expect(readStateSource(null)).toBeUndefined();
    expect(readStateSource({ manifestExtensions: { [APPLICATION_NAMESPACE]: { stateSource: 1 } } })).toBeUndefined();
  });

  it("sameStateSource: 区切りと先頭の ./ を無視し、.js と .ts（.mjs と .mts）を同じファイルとみなす", () => {
    expect(sameStateSource("src/state.ts", "src/state.js")).toBe(true);
    expect(sameStateSource("./src/state.js", "src\\state.ts")).toBe(true);
    expect(sameStateSource("state.mts", "state.mjs")).toBe(true);
    expect(sameStateSource("state.mts", "state.js")).toBe(false);
    expect(sameStateSource("src/state.ts", "src/app.ts")).toBe(false);
    expect(sameStateSource("src/state.tsx", "src/state.jsx")).toBe(false);
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

  it("stateSource: 別のファイルを指す manifest は乖離、無い manifest（4.26 より前）と .js / .ts の違いは乖離でない。--mount では比べない", () => {
    const withSource = JSON.stringify(buildManifest(null, schema, undefined, "src/old.ts"));
    expect(compareStateSchema(withSource, null, schema, "src/old.js")).toEqual({ kind: "same" });
    expect(compareStateSchema(withSource, null, schema, "src/state.ts")).toEqual({
      kind: "differs", changes: [], stateSource: { stored: "src/old.ts", expected: "src/state.ts" },
    });
    const both = compareStateSchema(withSource, null, { type: "object" }, "src/state.ts");
    expect(both).toEqual({
      kind: "differs",
      changes: ["- /properties/count/type", "- /required"],
      stateSource: { stored: "src/old.ts", expected: "src/state.ts" },
    });
    expect(compareStateSchema(text, null, schema, "src/state.ts")).toEqual({ kind: "same" });
    expect(compareStateSchema(withSource, null, schema)).toEqual({ kind: "same" });
    const volume = { type: "object", properties: { t: { type: "object" } } };
    const mounted = JSON.stringify(buildManifest("i18n", volume, JSON.parse(withSource)));
    expect(compareStateSchema(mounted, "i18n", volume, "src/i18n.ts")).toEqual({ kind: "same" });
  });

  it("stateMounts: --mount で書いたパスを記録する（重複なし・並べ替え）。ルートの emit は、記録されたボリュームの部分木を残す", () => {
    const volume = { type: "object", properties: { t: { type: "string" } } };
    const other = { type: "object", properties: { open: { type: "boolean" } } };
    const ns = (m: unknown): Record<string, any> => (m as any).manifestExtensions[APPLICATION_NAMESPACE];
    let m: unknown = buildManifest(null, schema, undefined, "src/app.ts");
    expect(ns(m).stateMounts).toBeUndefined();
    m = buildManifest("map", volume, m);
    m = buildManifest("faq", other, m);
    m = buildManifest("map", volume, m);
    expect(ns(m).stateMounts).toEqual(["faq", "map"]);
    expect(ns(m).stateSource).toBe("src/app.ts");
    // ルートの型が変わった: ルートのキーは置き換わり、ボリュームは残る
    const next = { type: "object", properties: { total: { type: "number" } }, required: ["total"] };
    const again = buildManifest(null, next, m, "src/app.ts");
    expect(ns(again).stateSchema).toEqual({ ...next, properties: { total: { type: "number" }, faq: other, map: volume } });
    expect(ns(again).stateMounts).toEqual(["faq", "map"]);
    // 新規に書く（既存を渡さない）なら、ボリュームは無い
    expect(ns(buildManifest(null, next)).stateMounts).toBeUndefined();
    // 記録にあるが部分木が無いパス、文字列でない記録は読み飛ばす
    const odd = { schemaVersion: 2, kind: "application", manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 2, stateSchema: schema, stateMounts: ["gone", 3, ""] } } };
    expect(ns(buildManifest(null, next, odd)).stateSchema).toEqual(next);
    expect(ns(buildManifest("x", volume, { ...odd, manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 2, stateSchema: schema, stateMounts: "map" } } })).stateMounts).toEqual(["x"]);
  });

  it("ルートの check は、stateMounts に記録されたボリュームの部分木を除いて比べる（深いパスの途中のノードも）", () => {
    const volume = { type: "object", properties: { t: { type: "string" } } };
    let m: unknown = buildManifest(null, schema, undefined, "src/app.ts");
    m = buildManifest("map", volume, m);
    m = buildManifest("shop.cart", volume, m);
    const stored = JSON.stringify(m);
    expect(compareStateSchema(stored, null, schema, "src/app.ts")).toEqual({ kind: "same" });
    expect(compareStateSchema(stored, "map", volume)).toEqual({ kind: "same" });
    expect(compareStateSchema(stored, "shop.cart", volume)).toEqual({ kind: "same" });
    // ルートの本当の乖離は今までどおり言う — ボリュームのキーは挙げない
    const drift = compareStateSchema(stored, null, { type: "object", properties: { count: { type: "string" } }, required: ["count"] }, "src/app.ts");
    expect(drift).toEqual({ kind: "differs", changes: ["~ /properties/count/type"] });
    // ルートが途中のノードを宣言している深いマウント: ルートの分は残して比べる
    const withShop = { type: "object", properties: { shop: { type: "object", properties: { name: { type: "string" } } } } };
    const deep = JSON.stringify(buildManifest("shop.cart", volume, buildManifest(null, withShop)));
    expect(compareStateSchema(deep, null, withShop)).toEqual({ kind: "same" });
    // 記録されたパスの部分木がもう無い manifest（手で消した）でも、比べられる
    const gone = JSON.parse(stored);
    delete gone.manifestExtensions[APPLICATION_NAMESPACE].stateSchema.properties.map;
    delete gone.manifestExtensions[APPLICATION_NAMESPACE].stateSchema.properties.shop;
    expect(compareStateSchema(JSON.stringify(gone), null, schema, "src/app.ts")).toEqual({ kind: "same" });
    const flat = JSON.parse(stored);
    flat.manifestExtensions[APPLICATION_NAMESPACE].stateSchema = { type: "object" };
    expect(compareStateSchema(JSON.stringify(flat), null, { type: "object" })).toEqual({ kind: "same" });
  });

  it("stateMounts の無い manifest（4.28 より前に --mount で書いた）は、今までどおりボリュームのキーを乖離として挙げる", () => {
    const volume = { type: "object", properties: { t: { type: "string" } } };
    const old = JSON.parse(JSON.stringify(buildManifest("map", volume, buildManifest(null, schema))));
    delete old.manifestExtensions[APPLICATION_NAMESPACE].stateMounts;
    const result = compareStateSchema(JSON.stringify(old), null, schema);
    expect(result).toEqual({ kind: "differs", changes: ["- /properties/map/properties/t/type", "- /properties/map/type"] });
  });

  it("stateSchema が無い / v1 manifest / JSON が壊れている", () => {
    const empty = JSON.stringify({ schemaVersion: 2, kind: "application", manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 2 } } });
    expect(compareStateSchema(empty, null, schema)).toEqual({ kind: "missing-state" });
    const v1 = JSON.stringify({ schemaVersion: 1, kind: "application", manifestExtensions: { [APPLICATION_NAMESPACE]: { version: 1, states: { default: { stateSchema: schema } } } } });
    expect(compareStateSchema(v1, null, schema)).toEqual({ kind: "v1-manifest" });
    expect(compareStateSchema("{ oops", null, schema).kind).toBe("broken");
  });
});
