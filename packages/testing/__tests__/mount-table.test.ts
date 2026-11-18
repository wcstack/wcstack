import { describe, it, expect, afterEach } from "vitest";
import { VERSION } from "@wcstack/state";
import { mount, settle } from "../src/exports";

/**
 * 表の中の <template>（seam app lending-desk）。happy-dom のパーサは <tbody> / <tr> などの直下の <template> を
 * 表の前へ追い出し、中身の行を表に残すので、mount() は `[wcs/wildcard-rank] ".name" is relative` で失敗していた。
 * ブラウザ（Chromium・Firefox・WebKit）はそこに <template> を置く。
 */

afterEach(() => {
  document.body.innerHTML = "";
});

const texts = (nodes: Iterable<Element>): (string | null)[] => Array.from(nodes, (el) => el.textContent);

describe("mount — 表の中の <template>", () => {
  it("<tbody> の for: 行とセルを <tbody> の中に描き、書き込みで行が増える", async () => {
    const app = await mount(`
      <wcs-state json='{"rows":[{"name":"Alice","age":30},{"name":"Bob","age":40}]}'></wcs-state>
      <table><tbody><template data-wcs="for: rows"><tr><td data-wcs="textContent: .name"></td><td data-wcs="textContent: .age"></td></tr></template></tbody></table>
    `);
    expect(texts(app.root.querySelectorAll("tbody > tr"))).toEqual(["Alice30", "Bob40"]);
    await app.state().write((s) => {
      s.rows = [...s.rows, { name: "Carol", age: 50 }];
    });
    await settle();
    expect(texts(app.root.querySelectorAll("tbody > tr"))).toEqual(["Alice30", "Bob40", "Carol50"]);
    expect(app.root.querySelector("table")!.previousElementSibling?.localName).not.toBe("template");
  });

  it("<tr> の中のセルの for: セルを行の中に描く", async () => {
    const app = await mount(`
      <wcs-state json='{"cells":["a","b","c"]}'></wcs-state>
      <table><tbody><tr><th>head</th><template data-wcs="for: cells"><td data-wcs="textContent: ."></td></template></tr></tbody></table>
    `);
    expect(texts(app.root.querySelectorAll("tbody > tr > td"))).toEqual(["a", "b", "c"]);
  });

  it("<tbody> の if: 行を出し入れする", async () => {
    const app = await mount(`
      <wcs-state json='{"show":false}'></wcs-state>
      <table><tbody><tr><td>first</td></tr><template data-wcs="if: show"><tr><td>shown</td></tr></template></tbody></table>
    `);
    expect(texts(app.root.querySelectorAll("tbody > tr"))).toEqual(["first"]);
    await app.state().write((s) => {
      s.show = true;
    });
    await settle();
    expect(texts(app.root.querySelectorAll("tbody > tr"))).toEqual(["first", "shown"]);
  });

  it("表の中の入れ子の for（<thead> と <tbody>）を、root: 'shadow' でも描く", async () => {
    const app = await mount(`
      <wcs-state json='{"heads":["x","y"],"rows":[{"cells":[1,2]},{"cells":[3,4]}]}'></wcs-state>
      <table>
        <thead><tr><template data-wcs="for: heads"><th data-wcs="textContent: ."></th></template></tr></thead>
        <tbody><template data-wcs="for: rows"><tr><template data-wcs="for: .cells"><td data-wcs="textContent: ."></td></template></tr></template></tbody>
      </table>
    `, { root: "shadow" });
    expect(app.root).toBeInstanceOf(ShadowRoot);
    expect(texts(app.root.querySelectorAll("thead th"))).toEqual(["x", "y"]);
    expect(texts(app.root.querySelectorAll("tbody > tr"))).toEqual(["12", "34"]);
  });

  it("行の中の <wcs-state> は、待ち続ける状態として拒まない（テンプレートの中身はページに無い）", async () => {
    const app = await mount(`
      <wcs-state json='{"rows":[]}'></wcs-state>
      <table><tbody><template data-wcs="for: rows"><tr><td><wcs-state mount="x"></wcs-state></td></tr></template></tbody></table>
    `);
    expect(app.root.querySelectorAll("tbody > tr").length).toBe(0);
  });

  it("renderToString の出力（<wcs-ssr> の中の行のテンプレートと行の印）を mount すると、サーバーの行を引き取る", async () => {
    // renderToString's output for
    //   <wcs-state enable-ssr json='{"rows":[…]}'></wcs-state>
    //   <table><tbody><template data-wcs="for: rows"><tr><td data-wcs="textContent: .name"></td></tr></template></tbody></table>
    // written out: this repository installs a happy-dom per package, and the server's window cannot
    // construct the elements this environment's classes define (server/__e2e__ renders and hydrates
    // with one happy-dom)
    const html =
      `<wcs-ssr version="${VERSION}"><script type="application/json">{"rows":[{"name":"Alice"},{"name":"Bob"}]}</script>` +
      `<template id="wcs-t0" data-wcs="for: rows"><tr><td data-wcs="textContent: .name"></td></tr></template></wcs-ssr>` +
      `<wcs-state enable-ssr="" json="{&quot;rows&quot;:[{&quot;name&quot;:&quot;Alice&quot;},{&quot;name&quot;:&quot;Bob&quot;}]}"></wcs-state>` +
      `<table><tbody><!--wcs-p:wcs-t0--><!--wcs-[--><!--wcs-|--><tr><td>Alice</td></tr><!--wcs-|--><tr><td>Bob</td></tr><!--wcs-]--></tbody></table>`;
    const app = await mount(html);
    const rows = app.root.querySelectorAll("tbody > tr");
    expect(texts(rows)).toEqual(["Alice", "Bob"]);
    await app.state().write((s) => {
      s.rows = [...s.rows, { name: "Carol" }];
    });
    await settle();
    const after = app.root.querySelectorAll("tbody > tr");
    expect(texts(after)).toEqual(["Alice", "Bob", "Carol"]);
    // the server's rows were adopted, not rendered again
    expect(after[0]).toBe(rows[0]);
  });
});
