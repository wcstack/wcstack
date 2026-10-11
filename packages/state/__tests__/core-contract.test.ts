import { describe, it, expect } from "vitest";
import { Engine, DirtyStrategy } from "../src/index";
import { installFeatures } from "../src/hooks";
import { diagnostics } from "../src/features/diagnostics";

// messages as the full bundle shows them: the diagnostics add-on appends the guidance
installFeatures([diagnostics]);

const make = (state: Record<string, any>) => new Engine(state, new DirtyStrategy());

/** `{ l: [ { l: [ … ] } ] }`, `depth` levels, the innermost list of `last` rows ({ v: i }). */
function nested(depth: number, last: number): any {
  if (depth === 1) return { l: Array.from({ length: last }, (_, i) => ({ v: i })) };
  return { l: [nested(depth - 1, last)] };
}

describe("$1 … $128（README の約束）", () => {
  it("10 段の行の getter から $10 が読める", () => {
    const path = `${"l.*.".repeat(10)}pos`;
    const e = make({
      ...nested(10, 4),
      get [path]() { return (this as any).$10; },
    });
    const idx = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3];
    expect(e.proxy.$resolve(path, idx)).toBe(3);
  });

  it.each(["$0", "$129", "$01"])("%s は [wcs/index-param-range] で投げる", (key) => {
    const e = make({ items: [1], get "items.*.x"() { return (this as any)[key]; } });
    expect(() => e.proxy.$resolve("items.*.x", [0])).toThrow("[wcs/index-param-range]");
  });
});

describe("添字の数（wcs/index-arity）", () => {
  const e = () => make({ m: [[1, 2], [3, 4]] });

  it("$resolve は * の数とちょうど同じ数が要る", () => {
    expect(e().proxy.$resolve("m.*.*", [1, 0])).toBe(3);
    expect(() => e().proxy.$resolve("m.*.*", [1])).toThrow("[wcs/index-arity]");
    expect(() => e().proxy.$resolve("m.*.*", [1, 0, 0])).toThrow("[wcs/index-arity]");
  });

  it("$getAll / $setAll は上限（少なければ残りを展開する）", () => {
    const s = e().proxy;
    expect(s.$getAll("m.*.*", [1])).toEqual([3, 4]);
    expect(() => s.$getAll("m.*.*", [1, 0, 0])).toThrow("[wcs/index-arity]");
    expect(() => s.$setAll("m.*.*", [0, 0, 0], 9)).toThrow("[wcs/index-arity]");
  });
});

describe("エラーコードは lint／VS Code 拡張と同じ語彙", () => {
  it("宣言していないトークンは [wcs/token-undeclared] と候補を出す", () => {
    const e = make({ $commandTokens: ["save"], $eventTokens: ["saved"] });
    expect(() => e.emitCommand("sav", new Event("click"), null)).toThrow(/\[wcs\/token-undeclared\].*Did you mean "save"/);
    expect(() => e.fireEventToken("savd", new Event("x"), null)).toThrow(/\[wcs\/token-undeclared\].*Did you mean "saved"/);
  });

  it("メッセージは [@wcstack/state] で始まる", () => {
    const e = make({ get g() { return 1; } });
    expect(() => { e.proxy.g = 2; }).toThrow(/^\[@wcstack\/state\] /);
  });
});

describe("トップレベルの欠落パス（wcs/binding-path-missing）", () => {
  it("状態に無いトップレベルのキーの読みは失敗し、診断が近い名前を出す", () => {
    const e = make({ count: 1 });
    expect(() => e.proxy.cout).toThrow(/\[wcs\/binding-path-missing\] Path "cout" does not exist on the state tree\. Did you mean "count"\?/);
  });

  it("深いパスの欠落は undefined（空値の約束で空になる）", () => {
    const e = make({ user: {} });
    expect(e.proxy["user.name"]).toBeUndefined();
  });

  it("まだ無いキーへの書き込みはできる（書いた後は読める）", () => {
    const e = make({});
    e.proxy.later = 5;
    expect(e.proxy.later).toBe(5);
  });
});

describe("後付けの宣言（wcs/feature-not-installed）", () => {
  it.each(["$watch", "$stream", "$listKeys", "$recursion"])("%s は入れる入口を案内して投げる", (key) => {
    expect(() => make({ [key]: {} })).toThrow(/\[wcs\/feature-not-installed\] \$\w+ needs the add-on @wcstack\/state\/features\/[\w-]+/);
  });

  it("$scan は廃止を伝える", () => {
    expect(() => make({ $scan: {} })).toThrow("$scan was removed");
  });

  it("状態のパスに ** を書くと [wcs/recursion-unsupported]", () => {
    const e = make({ nodes: [] });
    expect(() => e.proxy["nodes.**.x"]).toThrow("[wcs/recursion-unsupported]");
    expect(() => make({ get "nodes.**.total"() { return 0; } })).toThrow("[wcs/recursion-unsupported]");
  });
});
