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
  checkDeclaredPath, flushDeferredPathReports,
  clearReportedPaths,
  resolvePathExistence,
} from "../src/diagnostics/pathChecks";
import { missingRootPathMessage } from "../src/pathDiagnostics";
import { defineIndexPathAccessor, isIndexPath } from "../src/address/indexPathAccessor";
import { setDevtoolsSink } from "../src/platform/devtoolsSink";
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

describe("resolvePathExistence — 数値添字の束縛が生やした暗黙の getter を途中に含むパス（#388）", () => {
  /** State.defineTreeAccessor の代わりに、state へそのまま生やす（`for: groups.0.items` を描いた後の形） */
  function withIndexPathAccessor<T extends object>(state: T, path: string): T {
    const defineTreeAccessor = (key: string, descriptor: PropertyDescriptor): void => {
      Object.defineProperty(state, key, descriptor);
    };
    defineIndexPathAccessor({ defineTreeAccessor } as unknown as IStateElement, path);
    return state;
  }
  function withGetter<T extends object>(state: T, path: string): T {
    Object.defineProperty(state, path, { get: () => [], enumerable: true, configurable: true });
    return state;
  }

  it("暗黙の getter は宣言とみなさず、その先の行を辿って打ち間違いを missing にすること", () => {
    const state = withIndexPathAccessor({ groups: [{ items: [{ name: "a" }] }] }, "groups.0.items");
    // 修正前（#332 の後）: unknown（途中のプレフィックスの getter として、戻り値の形は評価しないと分からないに倒した）
    expect(resolvePathExistence(state, "groups.0.items.*.nmae", ["groups.0.items"])).toEqual({
      existence: "missing", missingSegment: "nmae", candidates: ["name"],
    });
    expect(resolvePathExistence(state, "groups.0.items.*.name", ["groups.0.items"]).existence).toBe("exists");
  });

  it("行 getter（groups.*.items.*.double）は素のパスの行（groups.0.items.*.double）を解決しないので missing のままにすること", () => {
    const state = withIndexPathAccessor(withGetter({ groups: [{ items: [{ n: 1 }] }] }, "groups.*.items.*.double"), "groups.0.items");
    const result = resolvePathExistence(state, "groups.0.items.*.double", ["groups.*.items.*.double", "groups.0.items"]);
    expect([result.existence, result.missingSegment]).toEqual(["missing", "double"]);
  });

  it("数値のキーを持つオブジェクト（sales.2024.items）の暗黙の getter も、その先を辿ること", () => {
    const state = withIndexPathAccessor({ sales: { "2024": { items: [{ name: "a" }] } } }, "sales.2024.items");
    const result = resolvePathExistence(state, "sales.2024.items.*.nmae", ["sales.2024.items"]);
    expect([result.existence, result.missingSegment]).toEqual(["missing", "nmae"]);
  });

  it("暗黙の getter が読む行のパス（items.*.sub）が宣言されていれば、作者の getter と同じく unknown にすること", () => {
    // `for: items.0.sub` の行は行 getter `items.*.sub` の戻り値。素のデータの行には `sub` が無い
    const state = withIndexPathAccessor(withGetter({ items: [{ v: 1 }] }, "items.*.sub"), "items.0.sub");
    expect(resolvePathExistence(state, "items.0.sub.*.x", ["items.*.sub", "items.0.sub"]).existence).toBe("unknown");
  });

  it("作者が同名の getter（groups.0.items）を宣言していれば、これまでどおり unknown にすること", () => {
    const state = withGetter({ groups: [{ items: [{ name: "a" }] }] }, "groups.0.items");
    expect(resolvePathExistence(state, "groups.0.items.*.nmae", ["groups.0.items"]).existence).toBe("unknown");
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
    flushDeferredPathReports(element);
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
    flushDeferredPathReports(element);
    checkDeclaredPath(element, state, "user.nmae", "binding");
    flushDeferredPathReports(element);
    expect(warn).toHaveBeenCalledTimes(1);
    clearReportedPaths(element);
    checkDeclaredPath(element, state, "user.nmae", "binding");
    flushDeferredPathReports(element);
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

  describe("数値添字のパス（#332 — 束縛はいまその位置にある行を読む）", () => {
    function rowGetterState(): object {
      const state = { items: [{ v: 1 }] };
      Object.defineProperty(state, "items.*.double", { get: () => 0, enumerable: true, configurable: true });
      return state;
    }
    /** State.setPathInfo と同じく、暗黙の getter を生やすかの判定（isIndexPath）を検査へ渡す */
    function checkBinding(element: IStateElement, state: object, path: string): void {
      checkDeclaredPath(element, state, path, "binding", isIndexPath(state, path));
    }

    it("行 getter（items.*.double）を数値添字で束縛しても報告しないこと", () => {
      const element = createStateElement({ getterPaths: new Set(["items.*.double"]) });
      checkBinding(element, rowGetterState(), "items.0.double");
      flushDeferredPathReports(element);
      // 修正前: `"double" is not declared` の wcs/binding-path-missing
      expect(warn).not.toHaveBeenCalled();
    });

    it("行に無いキーの打ち間違いは、書いた綴りのまま報告すること", () => {
      const element = createStateElement({ getterPaths: new Set(["items.*.double"]) });
      checkBinding(element, rowGetterState(), "items.0.dubble");
      flushDeferredPathReports(element);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toContain('Bound path "items.0.dubble"');
      expect(message).toContain('"dubble" is not declared');
      expect(message).toContain('Did you mean "double"?');
    });

    it("空のリスト・まだ行の無い位置の添字は判定不能として報告しないこと", () => {
      const element = createStateElement();
      checkBinding(element, { users: [] }, "users.0.name");
      checkBinding(element, { items: [{ v: 1 }] }, "items.5.v");
      flushDeferredPathReports(element);
      // 修正前: `"0" is not declared` / `"5" is not declared`（行が入れば解決するパスへの偽陽性）
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      // 数値のキーを持つオブジェクト（親が配列でない）は素のキーのまま検査する
      ["sales.2024.totl", { sales: { "2024": { total: 5 } } }, "totl"],
      ["sales.2025.total", { sales: { "2024": { total: 5 } } }, "2025"],
      // 負の添字は行になりえない
      ["items.-1.v", { items: [{ v: 1 }] }, "-1"],
      // 数値の区切りが 2 つ以上のパスは行を読まない（素のパスのまま）ので、修正前の検査のまま
      ["grid.5.0", { grid: [[1]] }, "5"],
    ])("行として読まない数値の区切り（%s）は、修正前と同じく報告すること", (path, state, missingSegment) => {
      const element = createStateElement();
      checkBinding(element, state, path);
      flushDeferredPathReports(element);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(`"${missingSegment}" is not declared`);
    });

    it("数値の区切りが 2 つ以上のパス・拡張できない state では、行 getter を宣言済みに数えないこと（束縛は素のパスを読んで空になる）", () => {
      const state = { groups: [{ items: [{ v: 1 }] }] };
      Object.defineProperty(state, "groups.*.items.*.double", { get: () => 0, enumerable: true, configurable: true });
      const element = createStateElement({ getterPaths: new Set(["groups.*.items.*.double", "items.*.double"]) });
      checkBinding(element, state, "groups.0.items.0.double");
      checkBinding(element, Object.freeze(rowGetterState()), "items.0.double");
      flushDeferredPathReports(element);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toContain('Bound path "groups.0.items.0.double"');
      expect(warn.mock.calls[1][0]).toContain('Bound path "items.0.double"');
      expect(warn.mock.calls[1][0]).toContain('"double" is not declared');
    });
  });

  it("報告を devtools sink にも流すこと", () => {
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((event) => { events.push(event); });
    const element = createStateElement();
    checkDeclaredPath(element, { user: { name: "Ann" } }, "user.nmae", "binding");
    flushDeferredPathReports(element);
    expect(events).toEqual([{
      type: "state:path-unresolved",
      source: "binding",
      path: "user.nmae",
      missingSegment: "nmae",
    }]);
  });
});

describe("missingRootPathMessage", () => {
  it("診断 code・did-you-mean・lint 誘導を含むこと", () => {
    const message = missingRootPathMessage("cout", { count: 0 }, []);
    expect(message).toContain("[wcs/binding-path-missing]");
    expect(message).toContain('Path "cout" does not exist on the state tree');
    expect(message).toContain('Did you mean "count"?');
    expect(message).toContain("npx @wcstack/lint");
  });

  it("近い候補が無ければ did-you-mean を付けないこと", () => {
    const message = missingRootPathMessage("zzzzzzzz", { count: 0 }, []);
    expect(message).not.toContain("Did you mean");
  });
});
