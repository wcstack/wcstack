// For / Index の一括削除 fast path（zero-reuse run で host がリスト領域だけを
// 含むとき、per-row remove() ではなく textContent="" で一括 detach する経路）と、
// ガード不成立時のフォールバックの検証。

import { describe, it, expect, vi, afterEach } from "vitest";
import { h, For, Index, signal, onCleanup, flushSync } from "../src/dom.js";

interface Person {
  id: number;
  name: string;
}

const P = (id: number, name: string): Person => ({ id, name });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("For: 一括削除 fast path", () => {
  it("全クリアは per-row remove() を使わず一括 detach し、anchor を保持して再追加できる", () => {
    const disposed: number[] = [];
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b"), P(3, "c")]);
    const ul = h("ul", null,
      For(list, (p) => {
        onCleanup(() => disposed.push(p.id));
        return h("li", null, p.name);
      }, { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(3);

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set([]);
    flushSync();

    // 一括経路: 個別 remove() は呼ばれない
    expect(removeSpy).not.toHaveBeenCalled();
    // dispose は行ごとに実行される
    expect(disposed).toEqual([1, 2, 3]);
    expect(ul.querySelectorAll("li").length).toBe(0);
    // anchor（コメントノード）は host に戻されている
    expect(ul.childNodes.length).toBe(1);
    expect(ul.firstChild!.nodeType).toBe(8 /* COMMENT_NODE */);

    // クリア後の再追加が正しく動く（anchor 位置が保たれている）
    list.set([P(4, "d"), P(5, "e")]);
    flushSync();
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["d", "e"]);
  });

  it("キーが全入れ替えの置換（zero-reuse）でも一括 detach し、新行を正順で描画する", () => {
    const disposed: number[] = [];
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const ul = h("ul", null,
      For(list, (p) => {
        onCleanup(() => disposed.push(p.id));
        return h("li", null, p.name);
      }, { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set([P(3, "c"), P(4, "d"), P(5, "e")]);
    flushSync();

    expect(removeSpy).not.toHaveBeenCalled();
    expect(disposed).toEqual([1, 2]);
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["c", "d", "e"]);
  });

  it("キーが一部共有される置換は従来の per-key 経路のまま", () => {
    const disposed: number[] = [];
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const ul = h("ul", null,
      For(list, (p) => {
        onCleanup(() => disposed.push(p.id));
        return h("li", null, p.name);
      }, { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();
    const kept = ul.querySelectorAll("li")[1];

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set([P(2, "b"), P(3, "c")]); // id=2 は再利用（zero-reuse ではない）
    flushSync();

    expect(removeSpy).toHaveBeenCalledTimes(1); // id=1 のみ個別削除
    expect(disposed).toEqual([1]);
    const after = [...ul.querySelectorAll("li")];
    expect(after.map((li) => li.textContent)).toEqual(["b", "c"]);
    expect(after[0]).toBe(kept);
  });

  it("anchor の後ろに静的兄弟がいると一括経路を諦めて per-row で削除する", () => {
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const ul = h("ul", null,
      For(list, (p) => h("li", null, p.name), { key: (p) => p.id }),
      h("li", { class: "static" }, "tail"),
    ) as HTMLUListElement;
    flushSync();

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set([]);
    flushSync();

    expect(removeSpy).toHaveBeenCalledTimes(2);
    // 静的兄弟は生き残る
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["tail"]);
  });

  it("領域の前に静的ノードがいると一括経路を諦めて per-row で削除する", () => {
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const ul = h("ul", null,
      h("li", { class: "static" }, "head"),
      For(list, (p) => h("li", null, p.name), { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set([]);
    flushSync();

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["head"]);
  });

  it("領域内に外部ノードが挿入されていると childNodes 数の不一致でフォールバックし外部ノードが生き残る", () => {
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const ul = h("ul", null,
      For(list, (p) => h("li", null, p.name), { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();

    // 契約違反だがガードで保守的に守る: 領域の中に外部ノードを差し込む
    const foreign = document.createElement("li");
    foreign.textContent = "foreign";
    ul.insertBefore(foreign, ul.querySelectorAll("li")[1]);

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set([]);
    flushSync();

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["foreign"]);
  });

  it("anchor ごと外部で detach 済みでも zero-reuse クリアが安全に dispose だけ行う", () => {
    const disposed: number[] = [];
    const list = signal<readonly Person[]>([P(1, "a"), P(2, "b")]);
    const ul = h("ul", null,
      For(list, (p) => {
        onCleanup(() => disposed.push(p.id));
        return h("li", null, p.name);
      }, { key: (p) => p.id }),
    ) as HTMLUListElement;
    flushSync();

    // 外部から host を空にする（anchor も行も detach される misuse ケース）
    ul.textContent = "";

    expect(() => {
      list.set([]);
      flushSync();
    }).not.toThrow();
    expect(disposed).toEqual([1, 2]);
  });
});

describe("Index: 一括削除 fast path", () => {
  it("全クリアは per-row remove() を使わず一括 detach し、anchor を保持して再追加できる", () => {
    const disposed: number[] = [];
    const list = signal<readonly string[]>(["a", "b", "c"]);
    const ul = h("ul", null,
      Index(list, (item) => {
        onCleanup(() => disposed.push(1));
        return h("li", null, () => item());
      }),
    ) as HTMLUListElement;
    flushSync();
    expect(ul.querySelectorAll("li").length).toBe(3);

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set([]);
    flushSync();

    expect(removeSpy).not.toHaveBeenCalled();
    expect(disposed.length).toBe(3);
    expect(ul.querySelectorAll("li").length).toBe(0);
    expect(ul.childNodes.length).toBe(1);
    expect(ul.firstChild!.nodeType).toBe(8 /* COMMENT_NODE */);

    list.set(["d", "e"]);
    flushSync();
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["d", "e"]);
  });

  it("部分 trim は従来の per-row 経路のまま", () => {
    const list = signal<readonly string[]>(["a", "b", "c"]);
    const ul = h("ul", null,
      Index(list, (item) => h("li", null, () => item())),
    ) as HTMLUListElement;
    flushSync();

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set(["a"]);
    flushSync();

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a"]);
  });

  it("anchor の後ろに静的兄弟がいると一括経路を諦めて per-row で削除する", () => {
    const list = signal<readonly string[]>(["a", "b"]);
    const ul = h("ul", null,
      Index(list, (item) => h("li", null, () => item())),
      h("li", { class: "static" }, "tail"),
    ) as HTMLUListElement;
    flushSync();

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set([]);
    flushSync();

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["tail"]);
  });

  it("領域の前に静的ノードがいるとフォールバックする", () => {
    const list = signal<readonly string[]>(["a", "b"]);
    const ul = h("ul", null,
      h("li", { class: "static" }, "head"),
      Index(list, (item) => h("li", null, () => item())),
    ) as HTMLUListElement;
    flushSync();

    const removeSpy = vi.spyOn(Element.prototype, "remove");
    list.set([]);
    flushSync();

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect([...ul.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["head"]);
  });

  it("anchor ごと外部で detach 済みでも全クリアが安全に dispose だけ行う", () => {
    const disposed: number[] = [];
    const list = signal<readonly string[]>(["a", "b"]);
    const ul = h("ul", null,
      Index(list, (item) => {
        onCleanup(() => disposed.push(1));
        return h("li", null, () => item());
      }),
    ) as HTMLUListElement;
    flushSync();

    ul.textContent = "";

    expect(() => {
      list.set([]);
      flushSync();
    }).not.toThrow();
    expect(disposed.length).toBe(2);
  });
});
