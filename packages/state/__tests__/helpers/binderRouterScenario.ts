/**
 * binder を本物の router から通すシナリオ（integration.binder.router*.test.ts、#409）。
 *
 * ルートの内容は、自分に宣言を持つ要素（button / span）の後ろに、for: を含む兄弟（ul）と
 * if: を含む兄弟（p）を置く。router はこれを直下のノード 1 つずつ binder へ渡す。
 * `<wcs-head>` の `<title data-wcs>` は、宣言を根に持つサブツリーとして head へ渡される。
 */
import type { State } from "../../src/components/State";
// @ts-expect-error -- the committed router bundle (packages/router/dist) has no declaration file beside it
import { bootstrapRouter as bootstrapRouterBundle } from "../../../router/dist/index.esm.js";

/** 本物の router（コミット済みのバンドル）の要素を登録する */
export const bootstrapRouter = bootstrapRouterBundle as () => void;

const flush = () => new Promise((r) => setTimeout(r, 0));
export const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await flush(); };

const CONTENT =
  `<button class="inc" data-wcs="onclick: inc">+</button>` +
  `<span class="msg" data-wcs="textContent: msg"></span>` +
  `<ul><template data-wcs="for: items"><li class="li">{{ . }}</li></template></ul>` +
  `<p><template data-wcs="if: on"><b class="on">on</b></template></p>`;

const HEAD = `<wcs-head><title data-wcs="textContent: msg"></title></wcs-head>`;

/**
 * `/` と `/v`。`shadow` ならルートの内容を `/v/x` に置き、shadow root のレイアウト（`<wcs-layout
 * enable-shadow-root>`）の中に入れる — `<wcs-layout-outlet>` が light DOM の子を 1 つずつ渡す形。
 */
export const ROUTER_PAGE = (shadow: boolean): string => `<template id="v-layout"><div class="frame"><slot></slot></div></template>
<wcs-router><template>
  <wcs-route path="/"><h1>home</h1></wcs-route>
  ${shadow
    ? `<wcs-route path="/v"><wcs-layout name="m" layout="v-layout" enable-shadow-root><wcs-route path="x">${HEAD}${CONTENT}</wcs-route></wcs-layout></wcs-route>`
    : `<wcs-route path="/v">${HEAD}${CONTENT}</wcs-route>`}
</template></wcs-router>`;

/** state の初期値。`inc` はボタンの onclick */
export const initialState = (): Record<string, unknown> => ({
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

export interface IRouterScenarioResult {
  /** 入場の直後・出て戻った直後・書き込みの後の表示 */
  seen: string[];
  /** クリックのたびの count */
  counts: number[];
  /** console.error に出たもの */
  errors: string[];
}

/**
 * `setup` でページを組み（state と router を入れ、着地させ）、`target` へ（着地と違えば遷移で）入る。
 * ボタンを押し、`/` へ出て戻ってもう一度押し、書き込みに追従するかを見る。
 */
export async function runRouterScenario(
  setup: () => Promise<State>,
  target: string,
): Promise<IRouterScenarioResult> {
  const base = document.createElement("base");
  base.setAttribute("href", "/");
  document.head.appendChild(base);
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    const stateElement = await setup();
    const router = document.querySelector("wcs-router") as unknown as { navigate(path: string): Promise<void> };
    const counts: number[] = [];
    const click = async (): Promise<void> => {
      (document.querySelector("button.inc") as HTMLButtonElement).click();
      await settle();
      stateElement.createState("readonly", (state) => { counts.push(state.count as number); });
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
    stateElement.createState("writable", (state) => { state.items = ["c"]; state.on = false; state.msg = "bye"; });
    await settle();
    seen.push(view());
    return { seen, counts, errors };
  } finally {
    console.error = original;
    document.body.innerHTML = "";
    base.remove();
    history.replaceState(null, "", "/");
  }
}
