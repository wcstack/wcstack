/**
 * regression-3x-binder-router.test.ts — @wcstack/state 3.5.1 の #409 / #414 の修正を、本物の router
 * （packages/router/dist — コミット済みのバンドル。3.x のテストと同じもの）から binder を通して state-next で確かめる。3.x の
 * integration.binder.router.test.ts・integration.binder.routerLanding.test.ts・
 * integration.binder.rowContextLanding.test.ts（helpers/binderRouterScenario.ts）の形。
 *
 * router はルートの内容を直下のノード 1 つずつ binder へ渡す（shadow root のレイアウトでは
 * `<wcs-layout-outlet>` が light DOM に置いた子を 1 つずつ）。自分に宣言を持つ要素の後ろの兄弟の
 * for: / if: が描かれなかった（#409）。遷移で入るたびに渡し直される内容の、行の中の if: が切り替わらなかった（#414）。
 *
 * どのテストも document に `<wcs-state>` を 1 つ置くので、テストの後でその document のエンジンを外す
 * （router の routeRange.stateNext.test.ts と同じ。実際のページは 1 つだけ）。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState, installFeatures, scopes } from "../src/index";
import { engines } from "../src/dom/mount";
// the committed router bundle, as the 3.x tests use it (its source is outside this package's rootDir)
// @ts-expect-error -- the bundle has no declaration file beside it (dist/index.d.ts is not index.esm.d.ts)
import { bootstrapRouter } from "../../router/dist/index.esm.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await flush(); };

beforeAll(() => {
  installFeatures([scopes]);
  bootstrapState();
  bootstrapRouter();
});

afterEach(() => {
  engines.delete(document);
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

const CONTENT =
  `<button class="inc" data-wcs="onclick: inc">+</button>` +
  `<span class="msg" data-wcs="textContent: msg"></span>` +
  `<ul><template data-wcs="for: items"><li class="li">{{ . }}</li></template></ul>` +
  `<p><template data-wcs="if: on"><b class="on">on</b></template></p>`;

const HEAD = `<wcs-head><title data-wcs="textContent: msg"></title></wcs-head>`;

/** `/` and `/v`; with `shadow`, the content sits at `/v/x` inside a shadow-root layout. */
const ROUTER_PAGE = (shadow: boolean): string => `<template id="v-layout"><div class="frame"><slot></slot></div></template>
<wcs-router><template>
  <wcs-route path="/"><h1>home</h1></wcs-route>
  ${shadow
    ? `<wcs-route path="/v"><wcs-layout name="m" layout="v-layout" enable-shadow-root><wcs-route path="x">${HEAD}${CONTENT}</wcs-route></wcs-layout></wcs-route>`
    : `<wcs-route path="/v">${HEAD}${CONTENT}</wcs-route>`}
</template></wcs-router>`;

const initialState = (): Record<string, unknown> => ({
  msg: "hi",
  items: ["a", "b"],
  on: true,
  count: 0,
  inc(this: { count: number }) { this.count++; },
});

const view = (): string => {
  const q = (selector: string) => Array.from(document.querySelectorAll(selector), (n) => n.textContent).join("/");
  return `msg=[${q("span.msg")}] li=[${q("li.li")}] on=[${q("b.on")}] title=[${document.title}]`;
};

const EXPECTED = [
  "msg=[hi] li=[a/b] on=[on] title=[hi]",
  "msg=[hi] li=[a/b] on=[on] title=[hi]",
  "msg=[bye] li=[c] on=[] title=[bye]",
];

/**
 * `setup` builds the page and lands; then enters `target` (by navigation when it differs), clicks, leaves
 * to `/`, comes back, clicks again, and writes. The views after entering, after coming back and after the write.
 */
async function runRouterScenario(setup: () => Promise<any>, target: string) {
  const base = document.createElement("base");
  base.setAttribute("href", "/");
  document.head.appendChild(base);
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map((a) => String((a as Error)?.message ?? a)).join(" ")); };
  try {
    const stateElement = await setup();
    const router = document.querySelector("wcs-router") as unknown as { navigate(path: string): Promise<void> };
    const counts: number[] = [];
    const click = async (): Promise<void> => {
      (document.querySelector("button.inc") as HTMLButtonElement).click();
      await settle();
      stateElement.createState("readonly", (state: any) => { counts.push(state.count as number); });
    };
    if (location.pathname !== target) {
      await router.navigate(target);
      await settle();
    }
    const seen = [view()];
    await click();
    await router.navigate("/");
    await settle();
    await router.navigate(target);
    await settle();
    seen.push(view());
    await click();
    stateElement.createState("writable", (state: any) => { state.items = ["c"]; state.on = false; state.msg = "bye"; });
    await settle();
    seen.push(view());
    return { seen, counts, errors };
  } finally {
    console.error = original;
    base.remove();
  }
}

/** Builds the state first, then puts the router in and lands on `landing`. */
async function stateFirst(landing: string, shadow: boolean): Promise<any> {
  history.replaceState(null, "", landing);
  document.body.innerHTML = `<wcs-state></wcs-state>`;
  const stateElement = document.querySelector("wcs-state") as any;
  stateElement.setInitialState(initialState());
  await stateElement.connectedCallbackPromise;
  await settle();
  document.body.insertAdjacentHTML("beforeend", ROUTER_PAGE(shadow));
  await settle();
  return stateElement;
}

describe("#409 本物の router から渡されたルートの内容", () => {
  it("遷移で入ったルート: 自分に宣言を持つ要素の後ろの兄弟の for: / if: が描かれ、1 回のクリックで 1 回だけ数える", async () => {
    const result = await runRouterScenario(() => stateFirst("/", false), "/v");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual(EXPECTED);
    expect(result.counts).toEqual([1, 2]);
  });

  it("shadow root のレイアウトの中のルートに遷移で入る: <wcs-layout-outlet> が light DOM の子を 1 つずつ渡しても、後ろの兄弟の for: / if: が描かれる", async () => {
    const result = await runRouterScenario(() => stateFirst("/", true), "/v/x");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual(EXPECTED);
    expect(result.counts).toEqual([1, 2]);
  });

  it("構築の後に router が着地したルート: 着地で 1 つずつ渡された内容の for: / if: が描かれ、二重に束ねない", async () => {
    const result = await runRouterScenario(() => stateFirst("/v", false), "/v");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual(EXPECTED);
    expect(result.counts).toEqual([1, 2]);
  });

  it("構築の後に router が着地した shadow root のレイアウト: for: / if: が描かれ、二重に束ねない", async () => {
    const result = await runRouterScenario(() => stateFirst("/v/x", true), "/v/x");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual(EXPECTED);
    expect(result.counts).toEqual([1, 2]);
  });

  it("（守り）router が先に着地し、state が後から構築する: 着地のルートの for: / if: と <wcs-head> の title が描かれ、出入りしても 1 回のクリックで 1 回", async () => {
    const result = await runRouterScenario(async () => {
      history.replaceState(null, "", "/v");
      document.body.innerHTML = `${ROUTER_PAGE(false)}<wcs-state></wcs-state>`;
      await settle();
      const stateElement = document.querySelector("wcs-state") as any;
      stateElement.setInitialState(initialState());
      await stateElement.connectedCallbackPromise;
      await settle();
      return stateElement;
    }, "/v");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual(EXPECTED);
    expect(result.counts).toEqual([1, 2]);
  });
});

describe("#409 / #414 本物の router: 出て戻ったルートの内容", () => {
  /** Builds the state, then puts in a router with `/` (landing) and `routes`. */
  async function openRoutes(routes: string, initial: Record<string, unknown>) {
    history.replaceState(null, "", "/");
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map((a) => String((a as Error)?.message ?? a)).join(" ")); };
    document.body.innerHTML = `<wcs-state></wcs-state>`;
    const stateElement = document.querySelector("wcs-state") as any;
    stateElement.setInitialState(initial);
    await stateElement.connectedCallbackPromise;
    await settle();
    document.body.insertAdjacentHTML("beforeend",
      `<wcs-router><template><wcs-route path="/"><h1>home</h1></wcs-route>${routes}</template></wcs-router>`);
    await settle();
    const router = document.querySelector("wcs-router") as unknown as { navigate(path: string): Promise<void> };
    return {
      errors,
      async navigate(path: string) { await router.navigate(path); await settle(); },
      async write(change: Record<string, unknown>) {
        stateElement.createState("writable", (state: any) => {
          for (const [path, value] of Object.entries(change)) state[path] = value;
        });
        await settle();
      },
      read(path: string) {
        let value: unknown;
        stateElement.createState("readonly", (state: any) => { value = state[path]; });
        return value;
      },
      done() { console.error = original; },
    };
  }

  const texts = (selector: string): string[] =>
    Array.from(document.querySelectorAll(selector), (node) => node.textContent ?? "");

  it("ルートの直下の Light DOM のマウント: 再入場でコンポーネントが中身を描き直しても、ホスト側の束縛（class. / attr. / onclick）が生きている", async () => {
    const tag = "r35-binder-redraw-card";
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

  it("行の中の if: は、遷移で出て戻った後も描かれ、切り替えられる（#414）", async () => {
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

describe("#414 構築の前に router が着地したルートの、行の中の if:", () => {
  it("構築の後で束ね直されても、行の中の if: を切り替えられる", async () => {
    history.replaceState(null, "", "/");
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map((a) => String((a as Error)?.message ?? a)).join(" ")); };
    const rows = (): string[] => Array.from(document.querySelectorAll(".row"), (node) => node.textContent ?? "");
    try {
      document.body.innerHTML = `<wcs-router><template>
        <wcs-route path="/"><ul><template data-wcs="for: items"><li><template data-wcs="if: on"><b class="row">{{ .name }}</b></template></li></template></ul></wcs-route>
      </template></wcs-router><wcs-state></wcs-state>`;
      await settle();
      const stateElement = document.querySelector("wcs-state") as any;
      stateElement.setInitialState({ on: true, items: [{ name: "a" }, { name: "b" }] });
      await stateElement.connectedCallbackPromise;
      await settle();
      expect(rows()).toEqual(["a", "b"]);
      stateElement.createState("writable", (state: any) => { state.on = false; });
      await settle();
      expect(rows()).toEqual([]);
      stateElement.createState("writable", (state: any) => { state.on = true; });
      await settle();
      expect(rows()).toEqual(["a", "b"]);
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
    }
  });
});
