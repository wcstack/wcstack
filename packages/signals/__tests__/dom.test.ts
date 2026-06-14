import { describe, it, expect, vi } from "vitest";
import { h, Fragment, render } from "../src/dom.js";
import { signal, flushSync, createRoot } from "../src/reactive.js";

describe("h: 要素と静的 props", () => {
  it("タグと文字列 child から要素を作る", () => {
    const el = h("div", null, "hello") as HTMLElement;
    expect(el.tagName).toBe("DIV");
    expect(el.textContent).toBe("hello");
  });

  it("class / className を className に写す", () => {
    expect((h("div", { class: "a" }) as HTMLElement).className).toBe("a");
    expect((h("div", { className: "b" }) as HTMLElement).className).toBe("b");
    expect((h("div", { class: null }) as HTMLElement).className).toBe("");
  });

  it("style を文字列・オブジェクト・null で扱う", () => {
    expect((h("div", { style: "color: red" }) as HTMLElement).style.color).toBe("red");
    expect((h("div", { style: { color: "blue" } }) as HTMLElement).style.color).toBe("blue");
    const el = h("div", { style: "color: red" }) as HTMLElement;
    // null で style 属性を消す（再設定経路）
    const el2 = h("div", { style: null }) as HTMLElement;
    expect(el2.hasAttribute("style")).toBe(false);
  });

  it("DOM プロパティ（id 等）はプロパティとして設定する", () => {
    const el = h("input", { id: "x", value: "v" }) as HTMLInputElement;
    expect(el.id).toBe("x");
    expect(el.value).toBe("v");
  });

  it("真偽属性: true で空属性、false / null で除去", () => {
    const el = h("div", { "data-on": true }) as HTMLElement;
    expect(el.getAttribute("data-on")).toBe("");
    const off = h("div", { "data-on": false }) as HTMLElement;
    expect(off.hasAttribute("data-on")).toBe(false);
    const nul = h("div", { "data-on": null }) as HTMLElement;
    expect(nul.hasAttribute("data-on")).toBe(false);
  });

  it("未知の属性は文字列として setAttribute する", () => {
    const el = h("div", { "data-x": 5 }) as HTMLElement;
    expect(el.getAttribute("data-x")).toBe("5");
  });

  it("onX ハンドラをイベントに紐付ける", () => {
    const onClick = vi.fn();
    const el = h("button", { onClick }) as HTMLButtonElement;
    el.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("h: reactive props", () => {
  it("関数 prop は signal 変化で更新される", () => {
    const cls = signal("a");
    const el = h("div", { class: () => cls.get() }) as HTMLElement;
    expect(el.className).toBe("a");
    cls.set("b");
    flushSync();
    expect(el.className).toBe("b");
  });

  it("signal を prop に直接渡せる", () => {
    const id = signal("one");
    const el = h("div", { id }) as HTMLElement;
    expect(el.id).toBe("one");
    id.set("two");
    flushSync();
    expect(el.id).toBe("two");
  });
});

describe("h: children", () => {
  it("数値・配列・ネスト配列・null・boolean を扱う", () => {
    const el = h("div", null, 1, ["-", 2], [["-", 3]], null, true, false) as HTMLElement;
    expect(el.textContent).toBe("1-2-3");
  });

  it("Node の child をそのまま追加する", () => {
    const span = h("span", null, "x");
    const el = h("div", null, span) as HTMLElement;
    expect(el.firstChild).toBe(span);
  });

  it("非 Node・非プリミティブの child は文字列化する", () => {
    const el = h("div", null, { toString: () => "obj" }) as HTMLElement;
    expect(el.textContent).toBe("obj");
  });
});

describe("h: reactive children", () => {
  it("関数 child（thunk）が signal でテキスト更新される", () => {
    const n = signal(0);
    const el = h("div", null, () => `count: ${n.get()}`) as HTMLElement;
    expect(el.textContent).toBe("count: 0");
    n.set(5);
    flushSync();
    expect(el.textContent).toBe("count: 5");
  });

  it("signal を child に直接渡せる", () => {
    const msg = signal("hi");
    const el = h("div", null, msg) as HTMLElement;
    expect(el.textContent).toBe("hi");
    msg.set("bye");
    flushSync();
    expect(el.textContent).toBe("bye");
  });

  it("条件で既存 Node をトグルする（remove/insert 経路）", () => {
    const show = signal(true);
    const a = h("span", null, "A");
    const el = h("div", null, () => (show.get() ? a : null)) as HTMLElement;
    expect(el.textContent).toBe("A");
    show.set(false);
    flushSync();
    expect(el.textContent).toBe("");
    show.set(true);
    flushSync();
    expect(el.textContent).toBe("A");
    expect(el.firstChild).toBe(a); // anchor（末尾コメント）の前に同一 Node を再挿入
    expect(el.firstChild?.nextSibling?.nodeType).toBe(8); // 次は anchor コメント
  });

  it("anchor が DOM から外れた後の更新は安全に no-op（host null 経路）", () => {
    const n = signal(0);
    const el = h("div", null, () => `v${n.get()}`) as HTMLElement;
    expect(el.textContent).toBe("v0");
    el.textContent = ""; // anchor コメントごと全 child を除去
    n.set(1); // effect 再実行時 anchor.parentNode は null
    flushSync();
    expect(el.textContent).toBe(""); // 例外なく no-op
  });

  it("reactive child が配列を返してもフラット化する", () => {
    const items = signal(["a", "b"]);
    const el = h("ul", null, () => items.get().map((t) => h("li", null, t))) as HTMLElement;
    expect(el.querySelectorAll("li").length).toBe(2);
    items.set(["x", "y", "z"]);
    flushSync();
    expect(el.querySelectorAll("li").length).toBe(3);
    expect(el.textContent).toBe("xyz");
  });
});

describe("Fragment とコンポーネント", () => {
  it("Fragment は複数 child をまとめる", () => {
    const frag = h(Fragment, null, h("i", null, "a"), h("b", null, "c"));
    const host = document.createElement("div");
    host.appendChild(frag);
    expect(host.textContent).toBe("ac");
  });

  it("コンポーネント関数に props と children を渡す", () => {
    const Box = (props: any) => h("section", { class: props.kind }, ...props.children);
    const el = h(Box, { kind: "note" }, "body") as HTMLElement;
    expect(el.tagName).toBe("SECTION");
    expect(el.className).toBe("note");
    expect(el.textContent).toBe("body");
  });

  it("配列を返すコンポーネントは fragment に包まれる", () => {
    const List = () => [h("li", null, "1"), h("li", null, "2")];
    const el = h(List, null) as DocumentFragment;
    const host = document.createElement("ul");
    host.appendChild(el);
    expect(host.querySelectorAll("li").length).toBe(2);
  });
});

describe("render", () => {
  it("child を container に追加する", () => {
    const host = document.createElement("div");
    render(h("p", null, "yo"), host);
    expect(host.querySelector("p")?.textContent).toBe("yo");
  });
});

describe("ownership: 動的 child のリーク解消", () => {
  it("subtree を作り直すと内側の reactive prop effect が dispose される", () => {
    const outer = signal(true);
    const inner = signal("x");
    let innerRuns = 0;
    const Span = () =>
      h("span", {
        title: () => {
          innerRuns++;
          return inner.get();
        },
      });

    const el = h("div", null, () => (outer.get() ? Span() : "gone")) as HTMLElement;
    expect(innerRuns).toBe(1);

    inner.set("y");
    flushSync();
    expect(innerRuns).toBe(2); // subtree が生きている間は反応する

    outer.set(false); // subtree を "gone" に作り直す → 内側 effect は dispose
    flushSync();
    expect(el.textContent).toBe("gone");

    inner.set("z");
    flushSync();
    expect(innerRuns).toBe(2); // dispose 済み → もう反応しない（リークしない）
  });

  it("subtree を作り直すとイベントリスナも除去される（onCleanup 経由）", () => {
    const show = signal(true);
    const onClick = vi.fn();
    let button: HTMLButtonElement | null = null;
    const Btn = () => {
      button = h("button", { onClick }, "go") as HTMLButtonElement;
      return button;
    };
    h("div", null, () => (show.get() ? Btn() : "x"));
    const captured = button!;
    captured.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    show.set(false); // subtree 破棄 → リスナ除去
    flushSync();
    captured.click(); // 既に除去済み
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("createRoot で mount し、dispose でツリー全体の反応を止める", () => {
    const n = signal(0);
    let runs = 0;
    let dispose!: () => void;
    const el = createRoot((d) => {
      dispose = d;
      return h("div", { title: () => {
        runs++;
        return String(n.get());
      } }) as HTMLElement;
    });
    expect((el as HTMLElement).title).toBe("0");
    n.set(1);
    flushSync();
    expect((el as HTMLElement).title).toBe("1");
    expect(runs).toBe(2);

    dispose();
    n.set(2);
    flushSync();
    expect(runs).toBe(2); // unmount 後は更新されない
  });
});
