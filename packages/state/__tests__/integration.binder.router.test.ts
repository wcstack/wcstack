/**
 * binder を本物の router（packages/router/dist — コミット済みのバンドル）から通す統合テスト（#409 / #414）。
 *
 * router はルートの内容を直下のノード 1 つずつ binder へ渡す。shadow root のレイアウトでは
 * `<wcs-layout-outlet>` が light DOM に置いた子を 1 つずつ渡す。自分に宣言を持つ要素の後ろに、
 * 構造テンプレートを含む兄弟があると、そのテンプレートが描かれなかった（#409）。遷移で入るたびに
 * 渡し直されるルートの内容では、行の中のノードのループ文脈が消え、行の中の `if:` が切り替わらなかった（#414）。
 *
 * ここでは state がバインドを構築し終えてから router を文書に入れる（@wcstack/testing の
 * mount() と同じ順）。着地のルートも binder が束ねる。router が先に着地し、state が後から構築する順は
 * integration.binder.routerLanding.test.ts と integration.binder.rowContextLanding.test.ts。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { ROUTER_PAGE, bootstrapRouter, initialState, runRouterScenario, settle } from "./helpers/binderRouterScenario";

beforeAll(() => {
  bootstrapState();
  bootstrapRouter();
});

const EXPECTED = [
  "msg=[hi] li=[a/b] on=[on] title=[hi]",
  "msg=[hi] li=[a/b] on=[on] title=[hi]",
  "msg=[bye] li=[c] on=[] title=[bye]",
];

/** state を先に構築し、その後で router を入れて `landing` に着地させる */
async function stateFirst(landing: string, shadow: boolean): Promise<State> {
  history.replaceState(null, "", landing);
  document.body.innerHTML = `<wcs-state></wcs-state>`;
  const stateElement = document.querySelector("wcs-state") as State;
  stateElement.setInitialState(initialState());
  await stateElement.connectedCallbackPromise;
  await settle();
  document.body.insertAdjacentHTML("beforeend", ROUTER_PAGE(shadow));
  await settle();
  return stateElement;
}

describe("本物の router から渡されたルートの内容（#409）", () => {
  it("遷移で入ったルート: 自分に宣言を持つ要素の後ろの兄弟の for: / if: が描かれ、1 回のクリックで 1 回だけ数えること", async () => {
    const result = await runRouterScenario(() => stateFirst("/", false), "/v");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual(EXPECTED);
    expect(result.counts).toEqual([1, 2]);
  });

  it("shadow root のレイアウトの中のルートに遷移で入る: <wcs-layout-outlet> が light DOM の子を 1 つずつ渡しても、後ろの兄弟の for: / if: が描かれること", async () => {
    const result = await runRouterScenario(() => stateFirst("/", true), "/v/x");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual(EXPECTED);
    expect(result.counts).toEqual([1, 2]);
  });

  it("構築の後に router が着地したルート: 着地で 1 つずつ渡された内容の for: / if: が描かれ、二重に束ねないこと", async () => {
    const result = await runRouterScenario(() => stateFirst("/v", false), "/v");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual(EXPECTED);
    expect(result.counts).toEqual([1, 2]);
  });

  it("構築の後に router が着地した shadow root のレイアウト: for: / if: が描かれ、二重に束ねないこと", async () => {
    const result = await runRouterScenario(() => stateFirst("/v/x", true), "/v/x");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual(EXPECTED);
    expect(result.counts).toEqual([1, 2]);
  });
});

describe("本物の router: 出て戻ったルートの内容", () => {
  interface IRouterPage {
    stateElement: State;
    navigate(path: string): Promise<void>;
    errors: string[];
    write(change: Record<string, unknown>): Promise<void>;
    read(path: string): unknown;
    done(): void;
  }

  /** state を構築し終えてから、`/`（着地）と `routes` を持つ router を入れる */
  async function openRoutes(routes: string, initial: Record<string, unknown>): Promise<IRouterPage> {
    history.replaceState(null, "", "/");
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    document.body.innerHTML = `<wcs-state></wcs-state>`;
    const stateElement = document.querySelector("wcs-state") as State;
    stateElement.setInitialState(initial);
    await stateElement.connectedCallbackPromise;
    await settle();
    document.body.insertAdjacentHTML("beforeend",
      `<wcs-router><template><wcs-route path="/"><h1>home</h1></wcs-route>${routes}</template></wcs-router>`);
    await settle();
    const router = document.querySelector("wcs-router") as unknown as { navigate(path: string): Promise<void> };
    return {
      stateElement,
      errors,
      async navigate(path) { await router.navigate(path); await settle(); },
      async write(change) {
        stateElement.createState("writable", (state) => {
          for (const [path, value] of Object.entries(change)) state[path] = value;
        });
        await settle();
      },
      read(path) {
        let value: unknown;
        stateElement.createState("readonly", (state) => { value = state[path]; });
        return value;
      },
      done() {
        console.error = original;
        document.body.innerHTML = "";
        history.replaceState(null, "", "/");
      },
    };
  }

  const texts = (selector: string): string[] =>
    Array.from(document.querySelectorAll(selector), (node) => node.textContent ?? "");

  it("ルートの直下の Light DOM のマウント: 再入場でコンポーネントが中身を描き直しても、ホスト側の束縛（class. / attr. / onclick）が生きていること", async () => {
    const tag = "binder-redraw-card";
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, unknown> = {};
      connectedCallback() {
        // draws its content on every connection, so its <wcs-state> sets its scope up again
        this.innerHTML =
          `<wcs-state bind-component="state"></wcs-state><span class="name" data-wcs="textContent: name"></span>`;
      }
    });
    const page = await openRoutes(
      `<wcs-route path="/u"><${tag} class="card" data-wcs="state: user; class.active: on; attr.data-n: n; onclick: inc"></${tag}></wcs-route>`,
      { user: { name: "Alice" }, on: true, n: 0, count: 0, inc(this: { count: number }) { this.count++; } },
    );
    try {
      await page.navigate("/u");
      await page.navigate("/");
      await page.navigate("/u");
      await page.write({ on: false, n: 5, "user.name": "Noa" });
      const card = document.querySelector(".card") as HTMLElement;
      expect(card.classList.contains("active")).toBe(false);
      expect(card.getAttribute("data-n")).toBe("5");
      expect(texts(".name")).toEqual(["Noa"]);
      card.click();
      await settle();
      expect(page.read("count")).toBe(1);
      expect(page.errors).toEqual([]);
    } finally {
      page.done();
    }
  });

  it("行の中の if: は、遷移で出て戻った後も描かれ、切り替えられること（#414）", async () => {
    const page = await openRoutes(
      `<wcs-route path="/v"><ul><template data-wcs="for: items"><li><template data-wcs="if: .on"><b class="row">{{ .name }}</b></template></li></template></ul></wcs-route>`,
      { items: [{ name: "a", on: true }, { name: "b", on: true }] },
    );
    try {
      await page.navigate("/v");
      expect(texts(".row")).toEqual(["a", "b"]);
      await page.navigate("/");
      await page.navigate("/v");
      expect(texts(".row")).toEqual(["a", "b"]);
      await page.write({ "items.0.on": false });
      expect(texts(".row")).toEqual(["b"]);
      await page.write({ "items.0.on": true });
      expect(texts(".row")).toEqual(["a", "b"]);
      expect(page.errors).toEqual([]);
    } finally {
      page.done();
    }
  });
});
