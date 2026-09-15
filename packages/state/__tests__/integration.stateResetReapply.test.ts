/**
 * integration.stateResetReapply.test.ts — 再セットは確立済みのバインドを新しい世代で適用し直す（#267）。
 *
 * 初期化済みの `<wcs-state>` に `setInitialState` で state を入れ直すと、読みは新しい世代を返す
 * （#258）。以前はバインドが次の書き込みまで動かず、画面だけが前の世代のまま残っていた。
 *
 * 契約（1 本ずつ固定する）:
 *  - 適用し直しは `setInitialState` の中で同期に済み、読みと画面が一致する。
 *  - 再セットは書き込みではない。`$watch` と `$updatedCallback` を起こさない。
 *  - 入れ直した後の書き込みは、通常どおり画面に届く。
 *  - 新しい state で消えたキーのバインドは、前の表示のまま黙らず、適用の失敗として報告する。
 *  - 切断中の再セットは、再接続したときに適用し直す。
 *  - 遷移の arbiter が居れば drain と同じく arbiter に渡す（SSR では渡さない）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { collectReapplyPaths } from "../src/apply/reapplyStateBindings";
import { TRANSITION_RUNNER_KEY } from "../src/protocol/transitionRunner";
import { flush, makeMount, node, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY];
  vi.restoreAllMocks();
});

const mount = makeMount("reapply-host");

const text = (root: ParentNode, selector: string): string | null => root.querySelector(selector)!.textContent;
const texts = (root: ParentNode, selector: string): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent);

/** getter を descriptor で足す（オブジェクトリテラルの getter は spread で評価されてしまう）。 */
const withGetter = (state: any, key: string, get: (this: any) => unknown): any => {
  Object.defineProperty(state, key, { get, enumerable: true, configurable: true });
  return state;
};

describe("適用し直す範囲", () => {
  it("行の getter も新しい世代で描画される（行数が変わっても）", async () => {
    const page = (names: string[]): any => withGetter(
      { items: names.map((name) => ({ name })) },
      "items.*.upper",
      function () { return String(this["items.*.name"]).toUpperCase(); },
    );
    const html = `<template data-wcs="for: items"><b class="u" data-wcs="textContent: items.*.upper"></b></template>`;
    const { host, shadowRoot, stateEl } = await mount(page(["a", "b"]), html);
    expect(texts(shadowRoot, ".u")).toEqual(["A", "B"]);

    stateEl.setInitialState(page(["x", "y", "z"]));
    expect(texts(shadowRoot, ".u")).toEqual(["X", "Y", "Z"]);
    host.remove();
  });

  it("同じ配列インスタンスを中身だけ変えて渡しても、行が描画し直される", async () => {
    const rows = [{ n: 1 }, { n: 2 }];
    const page = (): any => withGetter({ items: rows }, "items.*.double", function () { return this["items.*.n"] * 2; });
    const html =
      `<template data-wcs="for: items"><i class="n" data-wcs="textContent: items.*.n"></i>` +
      `<b class="d" data-wcs="textContent: items.*.double"></b></template>`;
    const { host, shadowRoot, stateEl } = await mount(page(), html);
    expect(texts(shadowRoot, ".d")).toEqual(["2", "4"]);
    const blocks = Array.from(shadowRoot.querySelectorAll(".n"));

    rows[0].n = 91;
    rows[1].n = 92;
    stateEl.setInitialState(page());
    expect(texts(shadowRoot, ".n")).toEqual(["91", "92"]);
    expect(texts(shadowRoot, ".d")).toEqual(["182", "184"]);
    expect(Array.from(shadowRoot.querySelectorAll(".n")), "同じ行オブジェクトの行は作り直さない").toEqual(blocks);
    host.remove();
  });

  it("if の分岐が新しい世代で切り替わる", async () => {
    const html =
      `<template data-wcs="if: open"><p class="yes">open</p></template>` +
      `<template data-wcs="else:"><p class="no">closed</p></template>`;
    const { host, shadowRoot, stateEl } = await mount({ open: true }, html);
    expect(shadowRoot.querySelector(".yes")).not.toBeNull();

    stateEl.setInitialState({ open: false });
    expect(shadowRoot.querySelector(".yes")).toBeNull();
    expect(shadowRoot.querySelector(".no")).not.toBeNull();
    host.remove();
  });

  it("双方向の input に新しい値が入り、その後の入力は新しい state へ書かれる", async () => {
    const { host, shadowRoot, stateEl } = await mount({ name: "a" }, `<input data-wcs="value: name">`);
    const input = shadowRoot.querySelector("input")!;
    expect(input.value).toBe("a");

    stateEl.setInitialState({ name: "b" });
    expect(input.value).toBe("b");

    input.value = "typed";
    input.dispatchEvent(new Event("input"));
    await flush();
    expect(read(stateEl, (s: any) => s.name)).toBe("typed");
    host.remove();
  });

  it("依存するパスが世代で変わる getter も、新しい依存で描画・追従する", async () => {
    const summing = (dep: string): any => withGetter(
      { items: [1, 2], values: [100, 200] },
      "sum",
      function () { return this[dep].reduce((a: number, b: number) => a + b, 0); },
    );
    const { host, shadowRoot, stateEl } = await mount(summing("items"), `<span id="s" data-wcs="textContent: sum"></span>`);
    expect(text(shadowRoot, "#s")).toBe("3");

    stateEl.setInitialState(summing("values"));
    expect(text(shadowRoot, "#s")).toBe("300");

    write(stateEl, (s: any) => { s.values = [1, 1]; });
    await flush();
    expect(text(shadowRoot, "#s")).toBe("2");
    host.remove();
  });

  it("入れ直した後の書き込み（スカラー・行の葉・リストの置換）は画面に届く", async () => {
    const html =
      `<span id="t" data-wcs="textContent: title"></span>` +
      `<template data-wcs="for: items"><i class="r" data-wcs="textContent: items.*.n"></i></template>`;
    const { host, shadowRoot, stateEl } = await mount({ title: "a", items: [{ n: 1 }] }, html);
    stateEl.setInitialState({ title: "b", items: [{ n: 5 }, { n: 6 }] });

    write(stateEl, (s: any) => { s.title = "c"; });
    await flush();
    expect(text(shadowRoot, "#t")).toBe("c");

    write(stateEl, (s: any) => { s.$resolve("items.*.n", [1], 60); });
    await flush();
    expect(texts(shadowRoot, ".r")).toEqual(["5", "60"]);

    write(stateEl, (s: any) => { s.items = [{ n: 7 }]; });
    await flush();
    expect(texts(shadowRoot, ".r")).toEqual(["7"]);
    host.remove();
  });

  describe("再帰の集計", () => {
    const recursiveTotals = (nodes: any): any => {
      const state: any = { nodes, $recursion: { "nodes.*": "children.*" } };
      Object.defineProperty(state, "nodes.**.total", {
        get(this: any) {
          return this["nodes.**.value"] +
            this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
        },
        enumerable: true, configurable: true,
      });
      return state;
    };
    const html =
      `<div><template data-wcs="for: nodes">` +
      `<span class="t" data-wcs="textContent: nodes.*.total"></span>` +
      `<template data-wcs="for: nodes.*.children">` +
      `<b class="c" data-wcs="textContent: nodes.*.children.*.total"></b></template>` +
      `</template></div>`;

    it("新しい木を入れ直すと、親行と子行の集計が新しい木で描画される", async () => {
      const { host, shadowRoot, stateEl } = await mount(recursiveTotals([node(7, [node(70)]), node(8)]), html);
      expect(texts(shadowRoot, ".t")).toEqual(["77", "8"]);
      expect(texts(shadowRoot, ".c")).toEqual(["70"]);

      stateEl.setInitialState(recursiveTotals([node(1, [node(10), node(20)])]));
      expect(texts(shadowRoot, ".t")).toEqual(["31"]);
      expect(texts(shadowRoot, ".c")).toEqual(["10", "20"]);
      host.remove();
    });

    it("同じノードオブジェクトの木を値だけ変えて入れ直しても、集計が描画し直される", async () => {
      const tree = [node(7, [node(70)]), node(8)];
      const { host, shadowRoot, stateEl } = await mount(recursiveTotals(tree), html);
      expect(texts(shadowRoot, ".t")).toEqual(["77", "8"]);

      tree[0].value = 1;
      tree[0].children[0].value = 10;
      stateEl.setInitialState(recursiveTotals(tree));
      expect(texts(shadowRoot, ".t")).toEqual(["11", "8"]);
      expect(texts(shadowRoot, ".c")).toEqual(["10"]);
      host.remove();
    });
  });
});

describe("再セットは書き込みではない", () => {
  it("$watch も $updatedCallback も起こさない（入れ直した後の書き込みでは従来どおり起きる）", async () => {
    const watched: unknown[] = [];
    let updatedCalls = 0;
    const page = (title: string): any => ({
      title,
      $watch: { title: (cur: unknown) => { watched.push(cur); } },
      $updatedCallback() { updatedCalls++; },
    });
    const { host, shadowRoot, stateEl } = await mount(page("a"), `<span id="t" data-wcs="textContent: title"></span>`);
    await flush();
    watched.length = 0;
    updatedCalls = 0;

    stateEl.setInitialState(page("b"));
    await flush();
    await flush();
    expect(text(shadowRoot, "#t")).toBe("b");
    expect(watched).toEqual([]);
    expect(updatedCalls).toBe(0);

    write(stateEl, (s: any) => { s.title = "c"; });
    await flush();
    await flush();
    expect(text(shadowRoot, "#t")).toBe("c");
    expect(watched).toEqual(["c"]);
    expect(updatedCalls).toBe(1);
    host.remove();
  });
});

describe("新しい state で消えたキー", () => {
  it("消えたリストの for は古い行を黙って残さず、適用の失敗として報告する（他のバインドは適用する）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html =
      `<span id="t" data-wcs="textContent: title"></span>` +
      `<template data-wcs="for: items"><i class="r" data-wcs="textContent: items.*.n"></i></template>`;
    const { host, shadowRoot, stateEl } = await mount({ title: "a", items: [{ n: 1 }] }, html);

    expect(() => stateEl.setInitialState({ title: "b" })).not.toThrow();
    expect(text(shadowRoot, "#t")).toBe("b");
    const messages = errorSpy.mock.calls.map((args) => String(args[0]));
    expect(messages.some((message) => message.includes(`binding "for: items" failed to apply`))).toBe(true);
    host.remove();
  });

  it("新しい state が $errorCallback を宣言していれば、失敗はそこへ配送される", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failures: string[] = [];
    const html = `<template data-wcs="for: items"><i class="r" data-wcs="textContent: items.*.n"></i></template>`;
    const { host, stateEl } = await mount({ items: [{ n: 1 }] }, html);

    stateEl.setInitialState({
      $errorCallback(_error: unknown, info: { path: string; bindingType: string }) {
        failures.push(`${info.bindingType}: ${info.path}`);
      },
    });
    expect(failures).toEqual(["for: items"]);
    expect(errorSpy.mock.calls.map((args) => String(args[0])).join(" | ")).not.toContain("failed to apply");
    host.remove();
  });
});

describe("構造と値の適用順", () => {
  it("if を閉じる再セットで、閉じる中身のバインディングは偽の失敗を報告しない（キーの並びに依らない）", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html =
      `<p id="s" data-wcs="textContent: status"></p>` +
      `<template data-wcs="if: loggedIn"><span class="n" data-wcs="textContent: user.name"></span>` +
      `<template data-wcs="for: user.items"><i class="r" data-wcs="textContent: user.items.*.n"></i></template></template>`;
    // `user` を `loggedIn` より前に置く — 閉じる中身のバインディングが先に集まる並び
    const { host, shadowRoot, stateEl } = await mount(
      { user: { name: "u", items: [{ n: 1 }] }, loggedIn: true, status: "in" },
      html,
    );
    expect(texts(shadowRoot, ".r")).toEqual(["1"]);

    const failures: string[] = [];
    stateEl.setInitialState({
      status: "out",
      loggedIn: false,
      $errorCallback(_error: unknown, info: { path: string; bindingType: string }) {
        failures.push(`${info.bindingType}: ${info.path}`);
      },
    });
    expect(failures).toEqual([]);
    expect(errorSpy.mock.calls.map((args) => String(args[0])).join(" | ")).not.toContain("failed to apply");
    expect(text(shadowRoot, "#s")).toBe("out");
    expect(shadowRoot.querySelector(".n")).toBeNull();
    expect(texts(shadowRoot, ".r")).toEqual([]);
    host.remove();
  });
});

describe("切断中の再セット", () => {
  it("再接続したときに適用し直す（切断中に 2 回入れ直せば、両方の世代のキーを最後の state で）", async () => {
    const html = `<span id="t" data-wcs="textContent: title"></span><span id="o" data-wcs="textContent: other"></span>`;
    const { host, shadowRoot, stateEl } = await mount({ title: "a", other: "x" }, html);

    stateEl.remove();
    stateEl.setInitialState({ title: "b", other: "y" });
    stateEl.setInitialState({ title: "c", other: "z" });
    expect(text(shadowRoot, "#t"), "切断中は適用先が無い").toBe("a");

    shadowRoot.appendChild(stateEl);
    await flush();
    expect(text(shadowRoot, "#t")).toBe("c");
    expect(text(shadowRoot, "#o")).toBe("z");
    host.remove();
  });
});

describe("遷移の arbiter", () => {
  /** 受け取った mutate を溜めるだけの arbiter（integration.viewTransition.test.ts と同じ形）。 */
  const installRunner = (): { deferred: Array<() => void>; sources: string[] } => {
    const deferred: Array<() => void> = [];
    const sources: string[] = [];
    (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY] = {
      protocol: "wcs-transition-runner",
      version: 1,
      naming: "manual",
      namingLimit: 200,
      accepts: () => true,
      run(mutate: () => void, runOptions?: { source?: string }) {
        sources.push(runOptions?.source ?? "");
        return new Promise<void>((resolve) => {
          deferred.push(() => { mutate(); resolve(); });
        });
      },
    };
    return { deferred, sources };
  };

  it("arbiter が居れば適用し直しを arbiter に渡し、mutate で反映する", async () => {
    const runner = installRunner();
    const { host, shadowRoot, stateEl } = await mount({ title: "a" }, `<span id="t" data-wcs="textContent: title"></span>`);
    expect(runner.sources).toEqual([]);

    stateEl.setInitialState({ title: "b" });
    expect(runner.sources).toEqual(["state"]);
    expect(text(shadowRoot, "#t"), "mutate までは反映しない").toBe("a");
    runner.deferred[0]();
    expect(text(shadowRoot, "#t")).toBe("b");
    host.remove();
  });

  it("SSR（サーバー側）では arbiter を通さず、その場で適用する", async () => {
    const runner = installRunner();
    document.documentElement.setAttribute("data-wcs-server", "");
    try {
      const { host, shadowRoot, stateEl } = await mount({ title: "a" }, `<span id="t" data-wcs="textContent: title"></span>`);
      stateEl.setInitialState({ title: "b" });
      expect(text(shadowRoot, "#t")).toBe("b");
      expect(runner.sources).toEqual([]);
      host.remove();
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
    }
  });
});

describe("collectReapplyPaths", () => {
  it("前後の state のデータと getter を集め、宣言面・ワイルドカードのキー・メソッドを除く", () => {
    class Page {
      title = "b";
      get upper(): string { return "B"; }
      method(): number { return 1; }
    }
    const previous: any = { old: 1, $watch: {}, "items.*.upper": 0 };
    Object.defineProperty(previous, "nodes.**.total", { get: () => 0, enumerable: true, configurable: true });
    expect([...collectReapplyPaths([previous, new Page(), undefined])].sort()).toEqual(["old", "title", "upper"]);
  });
});
