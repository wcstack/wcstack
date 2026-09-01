/**
 * bind-component の**入れ子形**の統合テスト。
 *
 * 親スコープの `for` の中にコンポーネントがあり、そのコンポーネントの子スコープでも
 * `for` を回す形（規則 `state.items: groups.*.children` に対して子が `for: items`）。
 *
 * §1.8 が成立させたのは「コンポーネントが親の `for` の外にいる」1 段だけの形で、
 * 入れ子形は「1 つの配列オブジェクトに 2 つの深さが要求される」ため対象外だった
 * （親から見た行は arity 2・子から見た行は arity 1 なのに、listIndex 台帳
 * `listIndexesByList` は配列同一性の WeakMap なので 1 組しか持てない）。
 *
 * 子が作る listIndex を base listIndex（＝ホストの親スコープ行）に親付けし、
 * スコープ内の「ワイルドカード位置 → チェーン段」変換を末尾起点にすることで成立させた
 * （docs/state-bind-component-nested-for-design.md）。
 *
 * 判別子は必ず **Shadow 内のビュー**。親スコープの行は親自身のバインディングなので、
 * 子への配送が死んでいても更新される（§1.7 の罠）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

const LIST_TEMPLATE =
  `<ul id="inner-view"><template data-wcs="for: items">` +
  `<li data-wcs="textContent: items.*.name"></li>` +
  `</template></ul>`;

/**
 * shadow の組み立て時期を 2 通り用意する。`connectedCallback` 形は再接続のたびに
 * 新しい state 要素になるが、`constructor` 形は state 要素が使い回される。
 * §1.9 の教訓 ＝ 片方だけでは配送断の欠落が見えない。
 */
type ShadowTiming = "constructor" | "connectedCallback";

function defineComponent(tag: string, timing: ShadowTiming, innerTemplate: string): void {
  class Component extends HTMLElement {
    // v2 の厳格 R1: 既定値 { items: [] } は私有になりマッピングを隠す（D19）
    state: Record<string, any> = {};
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      if (timing === "constructor") {
        this.shadowRoot!.innerHTML =
          `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
      }
    }
    connectedCallback() {
      if (timing === "connectedCallback" && this.shadowRoot!.childElementCount === 0) {
        this.shadowRoot!.innerHTML =
          `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
      }
    }
  }
  customElements.define(tag, Component);
}

async function mountNested(json: string, timing: ShadowTiming, innerTemplate = LIST_TEMPLATE) {
  const tag = uniqueTag("bcnf-item");
  defineComponent(tag, timing, innerTemplate);

  const host = document.createElement(uniqueTag("bcnf-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <wcs-state json='${json}'></wcs-state>
    <div id="outer"><template data-wcs="for: groups">
      <section>
        <h3 data-wcs="textContent: groups.*.title"></h3>
        <${tag} data-wcs="state.items: groups.*.children"></${tag}>
      </section>
    </template></div>
  `;
  document.body.appendChild(host);

  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();

  const components = () => Array.from(shadowRoot.querySelectorAll(tag)) as HTMLElement[];
  const settle = async () => {
    for (const component of components()) {
      const childShadow = component.shadowRoot!;
      const childStateElement = childShadow.querySelector("wcs-state") as State;
      await childStateElement.connectedCallbackPromise;
      await State.getBindingsReady(childShadow);
    }
    await flush();
  };
  await settle();

  /** 各コンポーネントの Shadow 内に描画された行テキスト */
  const rendered = () =>
    components().map((component) =>
      Array.from(component.shadowRoot!.querySelectorAll("#inner-view li")).map((li) => li.textContent));
  const outerTitles = () =>
    Array.from(shadowRoot.querySelectorAll("#outer h3")).map((h) => h.textContent);

  return { host, shadowRoot, parentStateElement, components, rendered, outerTitles, settle };
}

const TWO_GROUPS = JSON.stringify({
  groups: [
    { title: "G1", children: [{ name: "a" }, { name: "b" }] },
    { title: "G2", children: [{ name: "c" }] },
  ],
});

describe.each<ShadowTiming>(["constructor", "connectedCallback"])(
  "bind-component: 親 for の中のコンポーネントが子でも for を回す (shadow=%s)",
  (timing) => {
    it("各コンポーネントが自分の行の配列を描画すること", async () => {
      const { host, rendered, outerTitles } = await mountNested(TWO_GROUPS, timing);

      expect(outerTitles()).toEqual(["G1", "G2"]);
      expect(rendered()).toEqual([["a", "b"], ["c"]]);

      host.remove();
    });

    it("親からの行フィールド書き込みが該当コンポーネントの該当行にだけ届くこと", async () => {
      const { host, parentStateElement, rendered } = await mountNested(TWO_GROUPS, timing);

      parentStateElement.createState("writable", (s: any) => {
        s["groups.0.children.1.name"] = "b-updated";
      });
      await flush();

      expect(rendered()).toEqual([["a", "b-updated"], ["c"]]);

      host.remove();
    });

    // 親側にワイルドカードが乗る部分マウントでは、内側の具体添字パス
    //（items.0.name → groups.*.children.0.name）は「文脈と添字の混在」で
    // エンジンが受けない。行フィールドの書き戻しの語彙は $resolve の接頭辞翻訳
    //（P2-9・設計書 §4-6）— green に反転したら .fails を外すこと
    it.fails("子からの書き戻しが親 state に届くこと（P2-9 待ち）", async () => {
      const { host, components, parentStateElement, rendered } = await mountNested(TWO_GROUPS, timing);

      ((components()[1] as any).state as any).$resolve("items.*.name", [0], "c-from-child");
      await flush();

      let value: unknown;
      parentStateElement.createState("readonly", (s: any) => {
        value = s["groups.1.children.0.name"];
      });
      expect(value).toBe("c-from-child");
      expect(rendered()).toEqual([["a", "b"], ["c-from-child"]]);

      host.remove();
    });

    it("行の配列そのものを差し替えても子が追随すること", async () => {
      const { host, parentStateElement, rendered } = await mountNested(TWO_GROUPS, timing);

      parentStateElement.createState("writable", (s: any) => {
        s["groups.0.children"] = [{ name: "x" }, { name: "y" }, { name: "z" }];
      });
      await flush();

      expect(rendered()).toEqual([["x", "y", "z"], ["c"]]);

      host.remove();
    });

    it("子スコープのリストへの行追加・削除が通ること", async () => {
      const { host, components, rendered } = await mountNested(TWO_GROUPS, timing);

      const chroot = (components()[0] as any).state;
      chroot.items = [...chroot.items, { name: "b2" }];
      await flush();
      expect(rendered()).toEqual([["a", "b", "b2"], ["c"]]);

      chroot.items = (chroot.items as any[]).slice(0, 1);
      await flush();
      expect(rendered()).toEqual([["a"], ["c"]]);

      host.remove();
    });

    it("行を減らしても未処理例外を出さないこと（消えた行の stale read）", async () => {
      // 親スコープからの行通知は、その行を外す子の `for` より **先に** 適用される。
      // 同一スコープならトポロジカル順で `for` が先に来るのでこの窓は開かないが、
      // bind-component は親の通知と子の `for` が別経路で流れるため順序が保証されない。
      // 消えた行を指す読みが生の TypeError になると updater の drain も行ループも
      // 捕まえないので、同じバッチの無関係な更新まで道連れになる（§1.7 / §1.9 と同じ構図）。
      const errors: unknown[] = [];
      const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
        errors.push((event as any).error ?? (event as any).reason);
      };
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onError as EventListener);
      try {
        const { host, components, rendered } = await mountNested(TWO_GROUPS, timing);
        const chroot = (components()[0] as any).state;

        chroot.items = [{ name: "a" }, { name: "b" }, { name: "b2" }];
        await flush();
        chroot.items = [{ name: "a" }];
        await flush();

        expect(errors).toEqual([]);
        // 巻き添えが起きていないこと ＝ 他のコンポーネントも生きている
        expect(rendered()).toEqual([["a"], ["c"]]);

        host.remove();
      } finally {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onError as EventListener);
      }
    });

    it("親のリストを差し替えても各コンポーネントが自分の行を描き直すこと", async () => {
      const { host, parentStateElement, rendered, outerTitles, settle } =
        await mountNested(TWO_GROUPS, timing);

      parentStateElement.createState("writable", (s: any) => {
        s["groups"] = [
          { title: "H1", children: [{ name: "p" }] },
          { title: "H2", children: [{ name: "q" }, { name: "r" }] },
        ];
      });
      await flush();
      await settle();

      expect(outerTitles()).toEqual(["H1", "H2"]);
      expect(rendered()).toEqual([["p"], ["q", "r"]]);

      host.remove();
    });

    it("親のリストを並べ替えても行と子の対応が保たれること", async () => {
      const { host, parentStateElement, rendered, outerTitles, settle } =
        await mountNested(TWO_GROUPS, timing);

      parentStateElement.createState("writable", (s: any) => {
        const groups = s["groups"] as any[];
        s["groups"] = [groups[1], groups[0]];
      });
      await flush();
      await settle();

      expect(outerTitles()).toEqual(["G2", "G1"]);
      expect(rendered()).toEqual([["c"], ["a", "b"]]);

      host.remove();
    });

    it("並べ替えを往復しても読みが壊れないこと", async () => {
      // 並べ替えで行 content が動くと、コンポーネント要素は一度プール（DOM から外れる）を
      // 経由しうる。その間に境界の read が走ると、ノードのループ文脈を辿れず
      // `ListIndex not found: groups.*.children` になる。
      const errors: unknown[] = [];
      const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
        errors.push((event as any).error ?? (event as any).reason);
      };
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onError as EventListener);
      try {
        const { host, parentStateElement, rendered, outerTitles, settle } =
          await mountNested(TWO_GROUPS, timing);

        const swap = async () => {
          parentStateElement.createState("writable", (s: any) => {
            const groups = s["groups"] as any[];
            s["groups"] = [groups[1], groups[0]];
          });
          await flush();
          await settle();
        };

        await swap();
        expect(outerTitles()).toEqual(["G2", "G1"]);
        await swap();
        expect(outerTitles()).toEqual(["G1", "G2"]);

        parentStateElement.createState("writable", (s: any) => {
          s["groups.0.children.1.name"] = "b-after-roundtrip";
        });
        await flush();

        expect(rendered()).toEqual([["a", "b-after-roundtrip"], ["c"]]);
        expect(errors).toEqual([]);

        host.remove();
      } finally {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onError as EventListener);
      }
    });

    it("並べ替えのあとも親からの行フィールド書き込みが正しい子に届くこと", async () => {
      const { host, parentStateElement, rendered, settle } = await mountNested(TWO_GROUPS, timing);

      parentStateElement.createState("writable", (s: any) => {
        const groups = s["groups"] as any[];
        s["groups"] = [groups[1], groups[0]];
      });
      await flush();
      await settle();

      // 並べ替え後、G1 は DOM 上 2 番目。そこへ書いたものが 2 番目に出ること
      parentStateElement.createState("writable", (s: any) => {
        s["groups.1.children.0.name"] = "a-after-reorder";
      });
      await flush();

      expect(rendered()).toEqual([["c"], ["a-after-reorder", "b"]]);

      host.remove();
    });
  },
);

describe("bind-component 入れ子形: スコープの独立性", () => {
  it("$1 が子スコープ自身のループ段を指すこと（Δ が漏れないこと）", async () => {
    const template =
      `<ul id="inner-view"><template data-wcs="for: items">` +
      `<li data-wcs="textContent: items.*.name"></li>` +
      `<li class="idx" data-wcs="textContent: $1"></li>` +
      `</template></ul>`;
    const { host, components } = await mountNested(TWO_GROUPS, "constructor", template);

    const indexTexts = components().map((component) =>
      Array.from(component.shadowRoot!.querySelectorAll("#inner-view li.idx")).map((li) => li.textContent));
    // 判別子は 2 つ目のコンポーネント（親スコープでは行 1）。子スコープ自身の行番号が
    // 出るなら 0、Δ が漏れているなら 1 になる。
    // 数値 0 が "" として現れるのは happy-dom の非準拠挙動（実ブラウザは "0"）で、
    // wcstack 側の挙動ではない。0 と 1 の区別が付けば判別子としては十分。
    expect(indexTexts).toEqual([["", "1"], [""]]);

    host.remove();
  });

  // 現状はスコープ外の Δ 段が先頭に漏れる（[1,0]）。子スコープ相対への切り出しは
  // P2-9 の getScopedIndexes（設計書 §4-4）— green に反転したら .fails を外すこと
  it.fails("イベントハンドラが受け取るインデックスが子スコープのものであること（P2-9 待ち）", async () => {
    const pickLog: number[][] = [];
    const tag = uniqueTag("bcnf-evt");
    class Component extends HTMLElement {
      state: Record<string, any> = {
        pick(_event: Event, ...indexes: number[]) {
          pickLog.push(indexes);
        },
      };
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.shadowRoot!.innerHTML =
          `<wcs-state bind-component="state"></wcs-state>` +
          `<ul id="inner-view"><template data-wcs="for: items">` +
          `<li><button data-wcs="onclick: pick"></button></li>` +
          `</template></ul>`;
      }
    }
    customElements.define(tag, Component);

    const host = document.createElement(uniqueTag("bcnf-evthost"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <wcs-state json='${TWO_GROUPS}'></wcs-state>
      <div id="outer"><template data-wcs="for: groups">
        <${tag} data-wcs="state.items: groups.*.children"></${tag}>
      </template></div>
    `;
    document.body.appendChild(host);
    const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
    await parentStateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    const components = Array.from(shadowRoot.querySelectorAll(tag)) as HTMLElement[];
    for (const component of components) {
      const childShadow = component.shadowRoot!;
      await (childShadow.querySelector("wcs-state") as State).connectedCallbackPromise;
      await State.getBindingsReady(childShadow);
    }
    await flush();

    // 2 つ目のコンポーネント（親スコープの行 1）の唯一の行をクリックする。
    // 子スコープの行番号 0 が渡るべきで、親の行番号 1 が混ざってはいけない。
    const button = components[1].shadowRoot!.querySelector("button") as HTMLElement;
    button.click();
    await flush();

    expect(pickLog).toEqual([[0]]);

    // 1 つ目のコンポーネント（親スコープの行 0）の 2 行目 → 子スコープの行番号 1
    const secondRowButton =
      components[0].shadowRoot!.querySelectorAll("button")[1] as HTMLElement;
    secondRowButton.click();
    await flush();

    expect(pickLog).toEqual([[0], [1]]);

    host.remove();
  });

  // P2-9（$ API の接頭辞翻訳・設計書 §4-6）で green に反転したら .fails を外すこと
  it.fails("$resolve が子スコープのインデックスで往復できること（P2-9 待ち）", async () => {
    const { host, components } = await mountNested(TWO_GROUPS, "constructor");

    const value = ((components()[1] as any).state as any).$resolve("items.*.name", [0]);
    expect(value).toBe("c");

    host.remove();
  });

  it("同じコンポーネントを親 for の外でも使えること（Δ=0 との併存）", async () => {
    const tag = uniqueTag("bcnf-mixed");
    defineComponent(tag, "constructor", LIST_TEMPLATE);

    const host = document.createElement(uniqueTag("bcnf-mixedhost"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    const json = JSON.stringify({
      loose: [{ name: "L1" }],
      groups: [{ title: "G1", children: [{ name: "a" }] }],
    });
    shadowRoot.innerHTML = `
      <wcs-state json='${json}'></wcs-state>
      <${tag} id="loose" data-wcs="state.items: loose"></${tag}>
      <div id="outer"><template data-wcs="for: groups">
        <${tag} class="nested" data-wcs="state.items: groups.*.children"></${tag}>
      </template></div>
    `;
    document.body.appendChild(host);

    const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
    await parentStateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    for (const component of Array.from(shadowRoot.querySelectorAll(tag))) {
      const childShadow = (component as HTMLElement).shadowRoot!;
      await (childShadow.querySelector("wcs-state") as State).connectedCallbackPromise;
      await State.getBindingsReady(childShadow);
    }
    await flush();

    const textsOf = (selector: string) =>
      Array.from((shadowRoot.querySelector(selector) as HTMLElement).shadowRoot!
        .querySelectorAll("#inner-view li")).map((li) => li.textContent);

    expect(textsOf("#loose")).toEqual(["L1"]);
    expect(textsOf(".nested")).toEqual(["a"]);

    host.remove();
  });
});
