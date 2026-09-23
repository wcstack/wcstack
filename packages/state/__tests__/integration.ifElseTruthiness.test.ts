/**
 * integration.ifElseTruthiness.test.ts — `if:` / `else:` の真偽性の契約。
 *
 * `else:` は `if` のパース結果に `not` フィルタを足した束縛として組み立てられる
 * （`structural/createNotFilter.ts`）。`apply/applyChangeToIf.ts` は `if` 側を
 * `Boolean()` で寄せるので、`not` も同じ真偽性の規則でなければならない。
 * かつて `features/formats` の `not` が非 boolean で throw していたため、条件が
 * `0` / `""` / `undefined` / `null` のときに **どちらの枝も描かれない**（`if` は
 * false で外れ、`else` は throw して console.error に消える）回帰があった。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any) {
  const host = document.createElement(`ifelse-truthiness-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML =
    `<div id="wrap">` +
    `<template data-wcs="if: n"><span class="yes">yes</span></template>` +
    `<template data-wcs="else:"><span class="no">no</span></template>` +
    `</div><wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  const wrap = shadowRoot.querySelector("#wrap")!;
  return {
    host,
    stateElement,
    rendered: () => Array.from(wrap.querySelectorAll("span")).map((el) => el.className),
  };
}

describe("if / else の真偽性（非 boolean の条件）", () => {
  it.each([
    ["0", "no", 0],
    ["空文字", "no", ""],
    ["undefined", "no", undefined],
    ["null", "no", null],
    ["false", "no", false],
    ["1", "yes", 1],
    ["非空文字", "yes", "x"],
    ["true", "yes", true],
  ])("条件が %s のとき %s の枝だけが描かれること", async (_label, expected, n) => {
    const { host, rendered } = await mount({ n });
    expect(rendered()).toEqual([expected]);
    host.remove();
  });

  it("falsy な非 boolean へ書き換えても else へ切り替わること", async () => {
    const { host, stateElement, rendered } = await mount({ n: 1 });
    expect(rendered()).toEqual(["yes"]);
    stateElement.createState("writable", (s: any) => { s.n = 0; });
    await flush();
    expect(rendered()).toEqual(["no"]);
    stateElement.createState("writable", (s: any) => { s.n = 2; });
    await flush();
    expect(rendered()).toEqual(["yes"]);
    host.remove();
  });
});
