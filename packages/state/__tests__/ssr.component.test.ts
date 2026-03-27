import { describe, it, expect } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { Ssr } from "../src/components/Ssr";

beforeAll(() => {
  bootstrapState();
});

describe("Ssr コンポーネント", () => {
  it("wcs-ssr がカスタム要素として登録されている", () => {
    expect(customElements.get("wcs-ssr")).toBe(Ssr);
  });

  it("stateData で初期データ JSON を取得できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"count":42,"items":["a","b"]}</script>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.stateData).toEqual({ count: 42, items: ["a", "b"] });
  });

  it("name プロパティで name 属性を取得できる", () => {
    document.body.innerHTML = `<wcs-ssr name="cart"></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.name).toBe("cart");
  });

  it("name 属性がない場合は default", () => {
    document.body.innerHTML = `<wcs-ssr></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.name).toBe("default");
  });

  it("templates で UUID → テンプレートの Map を取得できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
        <template id="u0" data-wcs="for: items"><li></li></template>
        <template id="u1" data-wcs="if: show"><p></p></template>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.templates.size).toBe(2);
    expect(ssrEl.templates.has("u0")).toBe(true);
    expect(ssrEl.templates.has("u1")).toBe(true);
  });

  it("getTemplate(uuid) でテンプレートを取得できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
        <template id="u0" data-wcs="for: items"><li></li></template>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    const tpl = ssrEl.getTemplate("u0");
    expect(tpl).not.toBeNull();
    expect(tpl?.getAttribute("data-wcs")).toBe("for: items");
  });

  it("getTemplate で存在しない UUID は null を返す", () => {
    document.body.innerHTML = `<wcs-ssr name="default"><script type="application/json">{}</script></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.getTemplate("nonexistent")).toBeNull();
  });

  it("hydrateProps でプロパティ復元データを取得できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{}</script>
        <script type="application/json" data-wcs-ssr-props>{"wcs-ssr-0":{"innerHTML":"<b>bold</b>"}}</script>
      </wcs-ssr>
    `;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    expect(ssrEl.hydrateProps["wcs-ssr-0"]).toEqual({ innerHTML: "<b>bold</b>" });
  });

  it("setStateData() で初期データをプログラムからセットできる", () => {
    document.body.innerHTML = `<wcs-ssr name="default"></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    ssrEl.setStateData({ message: "set from code" });
    expect(ssrEl.stateData).toEqual({ message: "set from code" });
  });

  it("setHydrateProps() でプロパティ復元データをプログラムからセットできる", () => {
    document.body.innerHTML = `<wcs-ssr name="default"></wcs-ssr>`;
    const ssrEl = document.querySelector("wcs-ssr") as Ssr;
    ssrEl.setHydrateProps({ "el-0": { scrollTop: 100 } });
    expect(ssrEl.hydrateProps["el-0"]).toEqual({ scrollTop: 100 });
  });

  it("Ssr.findByName() で名前指定で検索できる", () => {
    document.body.innerHTML = `
      <wcs-ssr name="a"><script type="application/json">{"x":1}</script></wcs-ssr>
      <wcs-ssr name="b"><script type="application/json">{"y":2}</script></wcs-ssr>
    `;
    const a = Ssr.findByName(document.body, "a") as Ssr;
    const b = Ssr.findByName(document.body, "b") as Ssr;
    expect(a.stateData).toEqual({ x: 1 });
    expect(b.stateData).toEqual({ y: 2 });
  });

  it("Ssr.findByName() で見つからない場合は null", () => {
    document.body.innerHTML = `<div></div>`;
    expect(Ssr.findByName(document.body, "missing")).toBeNull();
  });
});
