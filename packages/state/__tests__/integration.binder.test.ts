/**
 * binder プロトコルを **実際のバインド経由**で確かめる統合テスト。
 *
 * 単体テスト（bindings.binder.test.ts）はプロトコルの発見と保留キューまでで、
 * 「渡したサブツリーに本当に値が入るか」は通らない。それがこの機能の全部なので、
 * 素の DOM に載せて確かめる。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getBinder } from "../src/protocol/binder";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;

/** shadow root に state を載せ、バインド構築の完了まで待つ。 */
async function mount(json: string, markup = "") {
  const host = document.createElement(`binder-host-${++counter}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${markup}`;
  document.body.appendChild(host);

  const stateElement = shadowRoot.querySelector("wcs-state") as State;
  await stateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();

  return { host, shadowRoot };
}

describe("binder: 後から差し込んだサブツリー", () => {
  it("構築後に差し込んだ要素の子孫バインドに値が入ること", async () => {
    const { host, shadowRoot } = await mount('{"msg":"hello"}');

    // 構築が終わったあとに現れるノード。従来はここに何も届かなかった。
    const late = document.createElement("section");
    late.innerHTML = `<span id="late" data-wcs="textContent: msg"></span>`;
    shadowRoot.appendChild(late);
    expect(shadowRoot.querySelector("#late")?.textContent).toBe("");

    getBinder()?.bind(late);
    await flush();

    expect(shadowRoot.querySelector("#late")?.textContent).toBe("hello");
    host.remove();
  });

  it("宣言がルート要素自身にあっても入ること", async () => {
    // `getSubscriberNodes` の TreeWalker はルート自身を返さないので、ここは
    // 別扱いが要る。`<wcs-head>` が head へ入れる `<title data-wcs>` がこの形。
    const { host, shadowRoot } = await mount('{"msg":"on-root"}');

    const late = document.createElement("span");
    late.id = "root-decl";
    late.setAttribute("data-wcs", "textContent: msg");
    shadowRoot.appendChild(late);

    getBinder()?.bind(late);
    await flush();

    expect(shadowRoot.querySelector("#root-decl")?.textContent).toBe("on-root");
    host.remove();
  });

  it("ルート宣言のノードを二度渡しても二重にならないこと", async () => {
    // `<wcs-head>` は再適用のたびに同じクローンを差し出しうる。
    const { host, shadowRoot } = await mount(String.raw`{"msg":"once"}`);
    const late = document.createElement("span");
    late.id = "twice";
    late.setAttribute("data-wcs", "textContent: msg");
    shadowRoot.appendChild(late);

    getBinder()?.bind(late);
    await flush();
    getBinder()?.bind(late);
    await flush();

    expect(shadowRoot.querySelector("#twice")?.textContent).toBe("once");
    host.remove();
  });

  it("差し込んだ後の state 変更にも追随すること", async () => {
    const { host, shadowRoot } = await mount('{"msg":"first"}');

    const late = document.createElement("section");
    late.innerHTML = `<span id="live" data-wcs="textContent: msg"></span>`;
    shadowRoot.appendChild(late);
    getBinder()?.bind(late);
    await flush();
    expect(shadowRoot.querySelector("#live")?.textContent).toBe("first");

    const stateElement = shadowRoot.querySelector("wcs-state") as State;
    stateElement.createState("writable", (state) => { state.msg = "second"; });
    await flush();

    expect(shadowRoot.querySelector("#live")?.textContent).toBe("second");
    host.remove();
  });

  it("二度渡しても二重に適用しないこと", async () => {
    // 呼ぶ側に「新しいノードだけ渡す」不変条件を負わせない、が D4 の趣旨。
    const { host, shadowRoot } = await mount('{"items":[1,2]}');

    const late = document.createElement("ul");
    late.innerHTML = `<template data-wcs="for: items"><li class="row"></li></template>`;
    shadowRoot.appendChild(late);

    getBinder()?.bind(late);
    await flush();
    const afterFirst = shadowRoot.querySelectorAll(".row").length;

    getBinder()?.bind(late);
    await flush();

    expect(shadowRoot.querySelectorAll(".row").length).toBe(afterFirst);
    host.remove();
  });

  it("構築時に既に居たノードを渡しても二重にならないこと", async () => {
    const { host, shadowRoot } = await mount(
      '{"msg":"already"}',
      `<section id="early"><span id="early-span" data-wcs="textContent: msg"></span></section>`,
    );
    expect(shadowRoot.querySelector("#early-span")?.textContent).toBe("already");

    getBinder()?.bind(shadowRoot.querySelector("#early") as Element);
    await flush();

    expect(shadowRoot.querySelector("#early-span")?.textContent).toBe("already");
    expect(shadowRoot.querySelectorAll("#early-span").length).toBe(1);
    host.remove();
  });
});

/**
 * 渡されたサブツリーの中だけを束ねる（#409）。
 *
 * router はルートの内容（`<wcs-layout-outlet>` が置いた中身も）を直下のノード 1 つずつ渡す。
 * 根が自分に宣言を持つとき、以前は親から走査していたので、後ろの兄弟の構造テンプレートに
 * まだ集められていないまま届き、普通の束縛として登録して適用に失敗し、二度と描かれなかった。
 */
describe("binder: 渡されたサブツリーの中だけを束ねる（#409）", () => {
  const ITEMS = '{"msg":"hi","items":["a","b"],"on":true}';

  /** console.error に出たものを集める */
  async function collectErrors(run: () => Promise<void>): Promise<string[]> {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    try {
      await run();
    } finally {
      console.error = original;
    }
    return errors;
  }

  /** ルートの内容のように、置いた後で直下の要素を 1 つずつ渡す */
  function placeAndHand(parent: ParentNode, markup: string): Element[] {
    const holder = document.createElement("template");
    holder.innerHTML = markup;
    const placed = Array.from(holder.content.children);
    parent.append(holder.content);
    for (const node of placed) {
      getBinder()?.bind(node);
    }
    return placed;
  }

  const texts = (root: ParentNode, selector: string): string[] =>
    Array.from(root.querySelectorAll(selector), (node) => node.textContent ?? "");

  it("自分に宣言を持つ要素の後ろの兄弟が含む for: / if: も描かれること", async () => {
    const { host, shadowRoot } = await mount(ITEMS);
    const outlet = document.createElement("div");
    shadowRoot.appendChild(outlet);
    const errors = await collectErrors(async () => {
      placeAndHand(outlet,
        `<span class="msg" data-wcs="textContent: msg"></span>` +
        `<ul><template data-wcs="for: items"><li class="row">{{ . }}</li></template></ul>` +
        `<p><template data-wcs="if: on"><b class="on">on</b></template></p>`);
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(shadowRoot, ".msg")).toEqual(["hi"]);
    expect(texts(shadowRoot, ".row")).toEqual(["a", "b"]);
    expect(texts(shadowRoot, ".on")).toEqual(["on"]);

    // 描いたものは生きている
    const stateElement = shadowRoot.querySelector("wcs-state") as State;
    stateElement.createState("writable", (state) => { state.items = ["c"]; state.on = false; });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["c"]);
    expect(texts(shadowRoot, ".on")).toEqual([]);
    host.remove();
  });

  it("ShadowRoot の直下（親が DocumentFragment）に置いて渡しても、後ろの兄弟の for: が描かれること", async () => {
    const { host, shadowRoot } = await mount(ITEMS);
    const errors = await collectErrors(async () => {
      placeAndHand(shadowRoot,
        `<span class="msg" data-wcs="textContent: msg"></span>` +
        `<ul><template data-wcs="for: items"><li class="row">{{ . }}</li></template></ul>`);
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(shadowRoot, ".msg")).toEqual(["hi"]);
    expect(texts(shadowRoot, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("渡されていない兄弟は束ねないこと（明示的に渡されたものだけ）", async () => {
    const { host, shadowRoot } = await mount(ITEMS);
    const outlet = document.createElement("div");
    outlet.innerHTML = `<i class="other" data-wcs="textContent: msg"></i>`;
    shadowRoot.appendChild(outlet);
    placeAndHand(outlet, `<span class="msg" data-wcs="textContent: msg"></span>`);
    await flush();
    expect(texts(shadowRoot, ".msg")).toEqual(["hi"]);
    expect(texts(shadowRoot, ".other")).toEqual([""]);
    host.remove();
  });

  it("根が宣言を持ち、中に構造テンプレートを持つサブツリーは、根も中身も描かれること", async () => {
    const { host, shadowRoot } = await mount(ITEMS);
    const outlet = document.createElement("div");
    shadowRoot.appendChild(outlet);
    const errors = await collectErrors(async () => {
      placeAndHand(outlet,
        `<section class="box" data-wcs="attr.data-msg: msg">` +
        `<ul><template data-wcs="for: items"><li class="row">{{ . }}</li></template></ul></section>`);
      await flush();
    });
    expect(errors).toEqual([]);
    expect(shadowRoot.querySelector(".box")?.getAttribute("data-msg")).toBe("hi");
    expect(texts(shadowRoot, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("根が宣言を持つ要素を、兄弟と一緒に何度渡しても、1 回のクリックで 1 回だけ数えること", async () => {
    const host = document.createElement(`binder-host-${++counter}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateElement = shadowRoot.querySelector("wcs-state") as State;
    stateElement.setInitialState({
      count: 0,
      items: ["a", "b"],
      inc(this: { count: number }) { this.count++; },
    });
    await stateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    const outlet = document.createElement("div");
    shadowRoot.appendChild(outlet);
    const errors = await collectErrors(async () => {
      const placed = placeAndHand(outlet,
        `<button class="inc" data-wcs="onclick: inc">+</button>` +
        `<b class="count">{{ count }}</b>` +
        `<ul><template data-wcs="for: items"><li class="row">{{ . }}</li></template></ul>`);
      for (const node of placed) getBinder()?.bind(node);
      await flush();
      (shadowRoot.querySelector(".inc") as HTMLButtonElement).click();
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(shadowRoot, ".count")).toEqual(["1"]);
    expect(texts(shadowRoot, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("構築の前に渡され、構築の走査がアンカーに置き換えた構造テンプレート（文書から外れた根）は束ねないこと", async () => {
    // router が着地のルートの内容を構築の前に渡す形（binder は居るが state はまだ構築していない）。
    // 構築の走査がテンプレートをアンカーに置き換えるので、預かった根は完了の時点で文書に居ない
    const host = document.createElement(`binder-host-${++counter}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state json='{"items":["a","b"]}'></wcs-state>` +
      `<template data-wcs="for: items"><i class="row">{{ . }}</i></template>`;
    const template = shadowRoot.querySelector("template") as HTMLTemplateElement;
    document.body.appendChild(host);
    const errors = await collectErrors(async () => {
      getBinder()?.bind(template);
      await (shadowRoot.querySelector("wcs-state") as State).connectedCallbackPromise;
      await State.getBindingsReady(shadowRoot);
      await flush();
    });
    expect(errors).toEqual([]);
    expect(template.isConnected).toBe(false);
    expect(texts(shadowRoot, ".row")).toEqual(["a", "b"]);
    host.remove();
  });

  it("文書に無いサブツリーは預からず、後で文書に入れて別のルートの構築が預かり分を流しても束ねないこと", async () => {
    // 預かると、そのサブツリーのルート（自分自身）の構築は来ないので待ち続ける。渡す側は、文書に
    // 入れた後で渡し直す（挿入の後に渡す — D5）
    const { host, shadowRoot } = await mount('{"msg":"built"}');
    const detached = document.createElement("span");
    detached.className = "detached";
    detached.setAttribute("data-wcs", "textContent: msg");
    getBinder()?.bind(detached);
    shadowRoot.appendChild(detached);
    // 別のルートの構築の完了が、預かり分を流す（drainPendingBinds）
    const other = await mount('{"msg":"other"}');
    expect(texts(shadowRoot, ".detached")).toEqual([""]);

    // 文書に入った後で渡せば束ねる
    getBinder()?.bind(detached);
    await flush();
    expect(texts(shadowRoot, ".detached")).toEqual(["built"]);
    other.host.remove();
    host.remove();
  });

  it("根が Light DOM のマウント（ホストから配線したコンポーネント）なら、根の配線だけを束ね、中身はコンポーネントのスコープに任せること", async () => {
    const tag = `binder-light-${++counter}`;
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, unknown> = {};
      connectedCallback() {
        if (this.childElementCount === 0) {
          this.innerHTML =
            `<wcs-state bind-component="state"></wcs-state>` +
            `<span class="inner" data-wcs="textContent: name"></span>` +
            `<ul><template data-wcs="for: tags"><li class="tag">{{ . }}</li></template></ul>`;
        }
      }
    });
    const { host, shadowRoot } = await mount('{"user":{"name":"Alice","tags":["x","y"]}}');
    const outlet = document.createElement("div");
    shadowRoot.appendChild(outlet);
    const errors = await collectErrors(async () => {
      const [component] = placeAndHand(outlet, `<${tag} data-wcs="state: user"></${tag}>`);
      await (component.querySelector("wcs-state") as State).connectedCallbackPromise;
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(shadowRoot, ".inner")).toEqual(["Alice"]);
    expect(texts(shadowRoot, ".tag")).toEqual(["x", "y"]);

    const stateElement = shadowRoot.querySelector("wcs-state") as State;
    stateElement.createState("writable", (state) => { state["user.name"] = "Noa"; });
    await flush();
    expect(texts(shadowRoot, ".inner")).toEqual(["Noa"]);
    host.remove();
  });

  it("すでに束ねたサブツリーをもう一度渡しても、行の中のノードのループ文脈を消さず、行の中の if: を切り替えられること（#414）", async () => {
    const { host, shadowRoot } = await mount(
      '{"on":true,"items":[{"name":"a"},{"name":"b"}]}',
      `<ul id="rows"><template data-wcs="for: items"><li><template data-wcs="if: on"><b class="row">{{ .name }}</b></template></li></template></ul>`,
    );
    const stateElement = shadowRoot.querySelector("wcs-state") as State;
    const errors = await collectErrors(async () => {
      getBinder()?.bind(shadowRoot.getElementById("rows") as Element);
      await flush();
      stateElement.createState("writable", (state) => { state.on = false; });
      await flush();
      expect(texts(shadowRoot, ".row")).toEqual([]);
      stateElement.createState("writable", (state) => { state.on = true; });
      await flush();
    });
    expect(errors).toEqual([]);
    expect(texts(shadowRoot, ".row")).toEqual(["a", "b"]);
    host.remove();
  });
});
