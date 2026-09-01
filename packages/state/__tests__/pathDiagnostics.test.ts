/**
 * pathDiagnostics.test.ts
 *
 * 「存在しないパスへの配線が黙って死ぬ」を破る検査の契約を固定する。
 *
 * 要点は 2 つ:
 * 1. **確実な miss だけ**を報告する（過小近似）。getter の戻り値の先・空配列・
 *    null 親のような「静的に決められない形」は必ず沈黙する ＝ 偽陽性ゼロ。
 * 2. 診断 code は lint / IDE と同一語彙で、面（binding / watch）で切り替わる。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkDeclaredPath,
  clearReportedPaths,
  missingRootPathMessage,
  resolvePathExistence,
} from "../src/pathDiagnostics";
import { setDevtoolsSink } from "../src/devtools/sink";
import type { IStateElement } from "../src/components/types";
import type { DevtoolsEvent } from "../src/devtools/types";

function createStateElement(overrides: Partial<IStateElement> = {}): IStateElement {
  return {
    name: "default",
    getterPaths: new Set<string>(),
    ...overrides,
  } as unknown as IStateElement;
}

describe("resolvePathExistence", () => {
  const NO_GETTERS: string[] = [];

  it("ネストしたデータパスが実在すれば exists になること", () => {
    const target = { user: { name: "Ann" } };
    expect(resolvePathExistence(target, "user.name", NO_GETTERS).existence).toBe("exists");
  });

  it("ドットパス getter はパス文字列そのもののキーとして exists になること", () => {
    const target = { users: [{ firstName: "Ann" }] };
    Object.defineProperty(target, "users.*.fullName", { get: () => "Ann S" });
    expect(resolvePathExistence(target, "users.*.fullName", NO_GETTERS).existence).toBe("exists");
  });

  it("ワイルドカードは先頭行の形で判定すること", () => {
    const target = { items: [{ price: 1 }] };
    expect(resolvePathExistence(target, "items.*.price", NO_GETTERS).existence).toBe("exists");
  });

  it("プロトタイプチェーン上の宣言も exists になること（クラス state）", () => {
    class Base { greet() { return "hi"; } }
    const target = new Base() as unknown as object;
    expect(resolvePathExistence(target, "greet", NO_GETTERS).existence).toBe("exists");
  });

  it("Object.prototype 由来は exists にしないこと（state が宣言したものだけを存在とみなす）", () => {
    const target = { user: {} };
    const result = resolvePathExistence(target, "user.hasOwnProperty", NO_GETTERS);
    expect(result.existence).toBe("missing");
  });

  it("ネストした打ち間違いは missing になり、失敗セグメントと兄弟候補を返すこと", () => {
    const target = { user: { name: "Ann", age: 3 } };
    const result = resolvePathExistence(target, "user.nmae", NO_GETTERS);
    expect(result.existence).toBe("missing");
    expect(result.missingSegment).toBe("nmae");
    expect(result.candidates).toContain("name");
    expect(result.candidates).toContain("age");
  });

  it("行オブジェクトに無い正解が getterPaths にある場合も候補に混ぜること", () => {
    const target = { items: [{ price: 1 }] };
    const result = resolvePathExistence(target, "items.*.subtotl", ["items.*.subtotal"]);
    expect(result.existence).toBe("missing");
    expect(result.candidates).toContain("subtotal");
  });

  it("孫の階層の名前は候補にしないこと", () => {
    const target = { items: [{ price: 1 }] };
    const result = resolvePathExistence(target, "items.*.xxx", ["items.*.a.b", "other.zzz"]);
    expect(result.candidates).not.toContain("a.b");
    expect(result.candidates).not.toContain("zzz");
  });

  // --- ここから下はすべて「黙る」ことの固定（偽陽性ゼロ） ---

  it("親が null なら unknown（初期値 null に後から代入する形を潰さない）", () => {
    const target = { user: null };
    expect(resolvePathExistence(target, "user.name", NO_GETTERS).existence).toBe("unknown");
  });

  it("親が undefined でも unknown になること", () => {
    const target = { user: undefined };
    expect(resolvePathExistence(target, "user.name", NO_GETTERS).existence).toBe("unknown");
  });

  it("途中が primitive なら unknown になること", () => {
    const target = { user: 1 };
    expect(resolvePathExistence(target, "user.name", NO_GETTERS).existence).toBe("unknown");
  });

  it("空配列のワイルドカードは unknown（行の形が分からない）", () => {
    const target = { items: [] };
    expect(resolvePathExistence(target, "items.*.price", NO_GETTERS).existence).toBe("unknown");
  });

  it("配列でないものへのワイルドカードは unknown になること", () => {
    const target = { items: {} };
    expect(resolvePathExistence(target, "items.*.price", NO_GETTERS).existence).toBe("unknown");
  });

  it("途中の getter の戻り値の先は unknown になること", () => {
    const target = {};
    Object.defineProperty(target, "profile", { get: () => ({ name: "Ann" }), enumerable: true });
    expect(resolvePathExistence(target, "profile.name", NO_GETTERS).existence).toBe("unknown");
  });

  it("末尾の getter は exists になること", () => {
    const target = { user: {} };
    Object.defineProperty(target.user, "label", { get: () => "x", enumerable: true });
    expect(resolvePathExistence(target, "user.label", NO_GETTERS).existence).toBe("exists");
  });

  it("途中のプレフィックスがフラット宣言されていれば unknown になること", () => {
    const target = { cart: {} };
    Object.defineProperty(target, "cart.total", { get: () => ({ label: "x" }), enumerable: true });
    expect(resolvePathExistence(target, "cart.total.label", NO_GETTERS).existence).toBe("unknown");
  });

  it("ルート直下の打ち間違いは missing になること（$watch 経路で使う）", () => {
    const target = { count: 0 };
    const result = resolvePathExistence(target, "cout", NO_GETTERS);
    expect(result.existence).toBe("missing");
    expect(result.missingSegment).toBe("cout");
  });
});

describe("checkDeclaredPath", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    setDevtoolsSink(null);
  });

  it("ネストした miss を lint と同じ診断 code で報告すること", () => {
    const element = createStateElement();
    checkDeclaredPath(element, { user: { name: "Ann" } }, "user.nmae", "binding");
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain("[wcs/binding-path-missing]");
    expect(message).toContain('Bound path "user.nmae"');
    expect(message).toContain('Did you mean "name"?');
    expect(message).toContain("npx @wcstack/lint");
  });

  it("同じパスは 1 回しか報告しないこと", () => {
    const element = createStateElement();
    const state = { user: { name: "Ann" } };
    checkDeclaredPath(element, state, "user.nmae", "binding");
    checkDeclaredPath(element, state, "user.nmae", "binding");
    expect(warn).toHaveBeenCalledTimes(1);
    clearReportedPaths(element);
    checkDeclaredPath(element, state, "user.nmae", "binding");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("実在するパスでは報告しないこと", () => {
    checkDeclaredPath(createStateElement(), { user: { name: "Ann" } }, "user.name", "binding");
    expect(warn).not.toHaveBeenCalled();
  });

  it("$ 始まりの予約名前空間は検査しないこと", () => {
    checkDeclaredPath(createStateElement(), {}, "$command.doIt", "binding");
    expect(warn).not.toHaveBeenCalled();
  });

  it("内部のパス翻訳（internal）は検査しないこと", () => {
    checkDeclaredPath(createStateElement(), { a: {} }, "a.b", "internal");
    expect(warn).not.toHaveBeenCalled();
  });

  it("state 未ロードでは検査しないこと", () => {
    checkDeclaredPath(createStateElement(), undefined, "a.b", "binding");
    expect(warn).not.toHaveBeenCalled();
  });

  it("単一セグメントのバインディングは検査しないこと（読み取り時に loud に落ちるため）", () => {
    checkDeclaredPath(createStateElement(), { count: 0 }, "cout", "binding");
    expect(warn).not.toHaveBeenCalled();
  });

  it("$watch のキーは単一セグメントでも検査し、watch 用の診断 code を使うこと", () => {
    checkDeclaredPath(createStateElement(), { count: 0 }, "cout", "watch");
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain("[wcs/watch-path-missing]");
    expect(message).toContain('$watch path "cout"');
    expect(message).toContain('Did you mean "count"?');
  });

  it("報告を devtools sink にも流すこと", () => {
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((event) => { events.push(event); });
    checkDeclaredPath(createStateElement(), { user: { name: "Ann" } }, "user.nmae", "binding");
    expect(events).toEqual([{
      type: "state:path-unresolved",
      source: "binding",
      stateName: "default",
      path: "user.nmae",
      missingSegment: "nmae",
    }]);
  });
});

describe("missingRootPathMessage", () => {
  it("診断 code・state 名・did-you-mean・lint 誘導を含むこと", () => {
    const message = missingRootPathMessage("default", "cout", { count: 0 }, []);
    expect(message).toContain("[wcs/binding-path-missing]");
    expect(message).toContain('Path "cout" does not exist on state "default"');
    expect(message).toContain('Did you mean "count"?');
    expect(message).toContain("npx @wcstack/lint");
  });

  it("近い候補が無ければ did-you-mean を付けないこと", () => {
    const message = missingRootPathMessage("default", "zzzzzzzz", { count: 0 }, []);
    expect(message).not.toContain("Did you mean");
  });
});
