import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeContract, analyzeManifestContract } from "../src/contract/contractAnalyzer";
import { setConfig } from "../src/config";
import { setDevtoolsSink } from "../src/devtools/sink";
import type { DevtoolsEvent } from "../src/devtools/types";
import type { IContractManifest, ILiveDeclaration } from "../src/contract/types";

function manifest(components: Record<string, unknown>, extraNamespaces: Record<string, unknown> = {}): IContractManifest {
  return {
    manifestExtensions: {
      "wcstack.types": { components } as never,
      ...extraNamespaces,
    },
  };
}

function live(
  properties: Record<string, string> = {},
  inputs: string[] = [],
  commands: string[] = [],
): ILiveDeclaration {
  return {
    propertyEvents: new Map(Object.entries(properties)),
    inputs: new Set(inputs),
    commands: new Set(commands),
  };
}

describe("analyzeManifestContract — pure core", () => {
  function run(m: IContractManifest, resolve: (tag: string) => ILiveDeclaration | null): DevtoolsEvent[] {
    const events: DevtoolsEvent[] = [];
    analyzeManifestContract(m, resolve, (e) => events.push(e));
    return events;
  }

  it("live と一致する component は manifest-read のみ(drift なし)", () => {
    const m = manifest({
      "wcs-fetch": {
        observables: { value: { event: "wcs-fetch:response" } },
        inputs: { url: {} },
        commands: { fetch: {} },
      },
    });
    const events = run(m, () => live({ value: "wcs-fetch:response" }, ["url"], ["fetch"]));
    expect(events).toEqual([{ type: "contract:manifest-read", tag: "wcs-fetch", loaded: true }]);
  });

  it("未登録タグは component-not-loaded drift", () => {
    const m = manifest({ "wcs-ghost": { observables: {} } });
    const events = run(m, () => null);
    expect(events).toEqual([
      { type: "contract:manifest-read", tag: "wcs-ghost", loaded: false },
      { type: "contract:drift", reason: "component-not-loaded", tag: "wcs-ghost" },
    ]);
  });

  it("live に無い observable / input / command は missing-member drift", () => {
    const m = manifest({
      "wcs-x": {
        observables: { ghost: { event: "e" } },
        inputs: { ghostIn: {} },
        commands: { ghostCmd: {} },
      },
    });
    const events = run(m, () => live()); // すべて空の live 宣言
    const drifts = events.filter((e) => e.type === "contract:drift");
    expect(drifts).toEqual([
      { type: "contract:drift", reason: "missing-member", tag: "wcs-x", member: "ghost" },
      { type: "contract:drift", reason: "missing-member", tag: "wcs-x", member: "ghostIn" },
      { type: "contract:drift", reason: "missing-member", tag: "wcs-x", member: "ghostCmd" },
    ]);
  });

  it("event 名の相違は event-mismatch drift(sidecar / live 両方を載せる)", () => {
    const m = manifest({ "wcs-x": { observables: { value: { event: "WRONG" } } } });
    const events = run(m, () => live({ value: "correct-event" }));
    expect(events).toContainEqual({
      type: "contract:drift",
      reason: "event-mismatch",
      tag: "wcs-x",
      member: "value",
      sidecarEvent: "WRONG",
      liveEvent: "correct-event",
    });
  });

  it("observables 不在の component は inputs / commands だけ照合する", () => {
    const m = manifest({ "wcs-x": { inputs: { a: {} }, commands: { c: {} } } });
    const events = run(m, () => live({}, ["a"], [])); // a はある / c は無い
    expect(events.filter((e) => e.type === "contract:drift")).toEqual([
      { type: "contract:drift", reason: "missing-member", tag: "wcs-x", member: "c" },
    ]);
  });

  it("event 未指定の observable は名前存在だけ照合し mismatch 判定しない", () => {
    const m = manifest({ "wcs-x": { observables: { value: {} } } });
    const events = run(m, () => live({ value: "any-event" }));
    expect(events.filter((e) => e.type === "contract:drift")).toEqual([]);
  });

  it("未知 namespace は unsupported-extension", () => {
    const m = manifest({}, { "acme.custom": { version: 1 }, "wcstack.async": {} });
    const events = run(m, () => null);
    expect(events).toContainEqual({ type: "contract:unsupported-extension", namespace: "acme.custom" });
    // 既知 namespace(wcstack.async)は unsupported にしない
    expect(events.some((e) => e.type === "contract:unsupported-extension" && e.namespace === "wcstack.async")).toBe(false);
  });

  it("manifestExtensions / components 不在は何も emit しない", () => {
    expect(run({}, () => null)).toEqual([]);
    expect(run({ manifestExtensions: {} }, () => null)).toEqual([]);
    expect(run({ manifestExtensions: { "wcstack.types": {} } }, () => null)).toEqual([]);
  });

  it("壊れた manifest(component が null / primitive)でも落ちず、後続 component も処理する", () => {
    const m = manifest({ "wcs-null": null as never, "wcs-num": 5 as never, "wcs-ok": { observables: { v: { event: "e" } } } });
    let events: DevtoolsEvent[] = [];
    expect(() => { events = run(m, (tag) => (tag === "wcs-ok" ? live({ v: "e" }) : live())); }).not.toThrow();
    // null/primitive component は manifest-read のみ(drift 走査は空扱い)、後続の wcs-ok も読める
    expect(events.filter((e) => e.type === "contract:manifest-read").map((e) => (e as { tag: string }).tag))
      .toEqual(["wcs-null", "wcs-num", "wcs-ok"]);
  });
});

describe("analyzeContract — public opt-in API", () => {
  let seq = 0;
  const events: DevtoolsEvent[] = [];

  function defineElement(tag: string, wcBindable: unknown): void {
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = wcBindable;
    });
  }

  beforeEach(() => {
    events.length = 0;
    setConfig({ enableContractAnalyzer: true });
    setDevtoolsSink((e) => events.push(e));
  });

  afterEach(() => {
    setConfig({ enableContractAnalyzer: false });
    setDevtoolsSink(null);
  });

  it("登録済み要素の live 宣言と drift を検出し、sink にも流す", () => {
    const tag = `x-fetch-${++seq}`;
    defineElement(tag, {
      protocol: "wc-bindable",
      version: 1,
      properties: [{ name: "value", event: "real-event" }],
      inputs: [{ name: "url" }],
    });
    const result = analyzeContract(manifest({
      [tag]: {
        observables: { value: { event: "STALE-event" }, ghost: { event: "x" } },
        inputs: { url: {} },
      },
    }));

    // 返り値 = sink 受信 と一致
    expect(result).toEqual(events);
    expect(result).toContainEqual({ type: "contract:manifest-read", tag, loaded: true });
    expect(result).toContainEqual(expect.objectContaining({ type: "contract:drift", reason: "event-mismatch", member: "value" }));
    expect(result).toContainEqual(expect.objectContaining({ type: "contract:drift", reason: "missing-member", member: "ghost" }));
  });

  it("properties/inputs を持たず commands のみの live 宣言も索引化する(不正エントリは無視)", () => {
    const tag = `x-cmd-${++seq}`;
    defineElement(tag, {
      protocol: "wc-bindable",
      version: 1,
      // properties / inputs 配列なし、commands のみ(名前が非文字列の不正エントリを混ぜる)
      commands: [{ name: "run" }, { name: 42 }, {}],
    });
    const result = analyzeContract(manifest({
      [tag]: { commands: { run: {}, missing: {} } },
    }));
    expect(result).toContainEqual({ type: "contract:manifest-read", tag, loaded: true });
    // run は live にあり drift なし、missing は無いので missing-member
    expect(result).toContainEqual({ type: "contract:drift", reason: "missing-member", tag, member: "missing" });
    expect(result.some((e) => e.type === "contract:drift" && (e as { member?: string }).member === "run")).toBe(false);
  });

  it("live wcBindable の properties/inputs/commands が非配列でも落ちない(container ガード)", () => {
    const tag = `x-bad-${++seq}`;
    defineElement(tag, {
      protocol: "wc-bindable",
      version: 1,
      properties: { name: "value", event: "e" }, // 配列でなく object(sidecar と混同した誤り)
      inputs: 42,
      commands: "nope",
    });
    const later = `x-later-${++seq}`;
    defineElement(later, { protocol: "wc-bindable", version: 1, properties: [{ name: "ok", event: "ok:e" }] });

    let result: readonly DevtoolsEvent[] = [];
    expect(() => {
      result = analyzeContract(manifest({
        [tag]: { observables: { value: { event: "e" } } },
        [later]: { observables: { ok: { event: "ok:e" } } },
      }));
    }).not.toThrow();
    // 壊れた要素は空宣言として扱われ、後続の well-formed 要素も処理される
    expect(result).toContainEqual({ type: "contract:manifest-read", tag, loaded: true });
    expect(result).toContainEqual({ type: "contract:manifest-read", tag: later, loaded: true });
    // properties が object なので value は live に無い扱い → missing-member
    expect(result).toContainEqual(expect.objectContaining({ type: "contract:drift", reason: "missing-member", tag, member: "value" }));
  });

  it("非 wc-bindable / 未定義の要素は component-not-loaded", () => {
    // 未定義タグ
    const undefinedTag = `x-none-${++seq}`;
    const r1 = analyzeContract(manifest({ [undefinedTag]: { observables: {} } }));
    expect(r1).toContainEqual({ type: "contract:drift", reason: "component-not-loaded", tag: undefinedTag });

    // wcBindable を持たない要素
    const plainTag = `x-plain-${++seq}`;
    customElements.define(plainTag, class extends HTMLElement {});
    const r2 = analyzeContract(manifest({ [plainTag]: { observables: {} } }));
    expect(r2).toContainEqual({ type: "contract:drift", reason: "component-not-loaded", tag: plainTag });
  });
});

describe("analyzeContract — zero cost when disabled (完了条件)", () => {
  it("フラグ off なら manifest を走査せず、sink も呼ばず、frozen empty を返す", () => {
    setConfig({ enableContractAnalyzer: false });
    const sink = vi.fn();
    setDevtoolsSink(sink);
    try {
      // 未知 namespace + 未登録タグ入り: 有効なら必ず emit するはずの manifest。
      const result = analyzeContract(manifest({ "x-any": { observables: {} } }, { "acme.x": {} }));
      expect(result).toHaveLength(0);
      expect(Object.isFrozen(result)).toBe(true); // 新規割当なし(共有 EMPTY)
      expect(sink).not.toHaveBeenCalled(); // 一切の副作用なし
    } finally {
      setDevtoolsSink(null);
    }
  });
});
