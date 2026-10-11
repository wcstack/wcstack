/**
 * Component mounts rendered on the server (`<html data-wcs-server>`, src/scopes/component.ts):
 * the `data-wcs-wired` marker a host binding leaves on an element whose markup carries no wiring.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes]);
  bootstrapState();
});

function define(markup: string): string {
  const tag = `cov-srv-cmp-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    state = {};
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${markup}`;
    }
  });
  return tag;
}

describe("サーバでのコンポーネントの結線の印（data-wcs-wired）", () => {
  it("行の要素には結線した名前を 1 度だけ書き、data-wcs を持つ要素には書かない", async () => {
    const tag = define(`<p>{{ a }}-{{ b }}</p>`);
    document.documentElement.setAttribute("data-wcs-server", "");
    try {
      const h = document.createElement(`cov-srv-page-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state>`
        + `<${tag} class="top" data-wcs="state.a: top.x; state.b: top.y"></${tag}>`
        + `<template data-wcs="for: rows"><${tag} class="row" data-wcs="state.a: .x; state.b: .y"></${tag}></template>`;
      const el = root.querySelector("wcs-state") as any;
      el.setInitialState({ top: { x: 1, y: 2 }, rows: [{ x: 3, y: 4 }] });
      document.body.appendChild(h);
      await el.connectedCallbackPromise;
      await getBindingsReady(root);
      for (let i = 0; i < 3; i++) await flush();
      const top = root.querySelector(".top")!;
      const row = root.querySelector(".row")!;
      // a row is a clone of its plan (no data-wcs): the marker names the head once for both entries
      expect(row.hasAttribute("data-wcs")).toBe(false);
      expect(row.getAttribute("data-wcs-wired")).toBe("state");
      // the markup of a top-level element keeps its wiring: no marker
      expect(top.hasAttribute("data-wcs-wired")).toBe(false);
      expect(top.shadowRoot!.querySelector("p")!.textContent).toBe("1-2");
      expect(row.shadowRoot!.querySelector("p")!.textContent).toBe("3-4");
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
    }
  });
});
