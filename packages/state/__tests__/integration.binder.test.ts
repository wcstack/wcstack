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
