import { describe, it, expect, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";

beforeAll(() => {
  bootstrapState();
});

/**
 * ヘルパー: バージョン不一致 SSR DOM をセットアップし、フォールバック完了を待機する
 */
async function setupFallback(html: string): Promise<{
  stateEl: any;
  warnSpy: ReturnType<typeof vi.spyOn>;
}> {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  document.body.innerHTML = html;
  const stateEl = document.querySelector("wcs-state") as any;
  await stateEl.connectedCallbackPromise;
  await new Promise(resolve => setTimeout(resolve, 300));
  return { stateEl, warnSpy };
}

describe("SSR フォールバック: ネスト構造", () => {

  it("for の中に for", async () => {
    const { stateEl, warnSpy } = await setupFallback(`
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{
          "groups":[
            {"name":"A","items":[{"v":"A1"},{"v":"A2"}]},
            {"name":"B","items":[{"v":"B1"}]}
          ]
        }</script>
        <template id="g0" data-wcs="for: groups">
          <div class="group">
            <h3 data-wcs="textContent: groups.*.name"></h3>
            <template data-wcs="for: groups.*.items">
              <span data-wcs="textContent: groups.*.items.*.v"></span>
            </template>
          </div>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"groups":[]}'>
      </wcs-state>
      <!--@@wcs-for:g0-->
      <!--@@wcs-for-start:g0:groups:0-->
      <div class="group">
        <h3 data-wcs="textContent: groups.*.name">A</h3>
        <span data-wcs="textContent: groups.*.items.*.v">A1</span>
        <span data-wcs="textContent: groups.*.items.*.v">A2</span>
      </div>
      <!--@@wcs-for-end:g0:groups:0-->
      <!--@@wcs-for-start:g0:groups:1-->
      <div class="group">
        <h3 data-wcs="textContent: groups.*.name">B</h3>
        <span data-wcs="textContent: groups.*.items.*.v">B1</span>
      </div>
      <!--@@wcs-for-end:g0:groups:1-->
    `);

    // グループが再構築されている
    const groups = document.querySelectorAll(".group");
    expect(groups.length).toBe(2);

    const h3s = document.querySelectorAll("h3");
    expect(h3s[0].textContent).toBe("A");
    expect(h3s[1].textContent).toBe("B");

    const spans = document.querySelectorAll("span");
    expect(spans.length).toBe(3);
    expect(spans[0].textContent).toBe("A1");
    expect(spans[1].textContent).toBe("A2");
    expect(spans[2].textContent).toBe("B1");

    // SSR アーティファクトが除去されている
    expect(document.querySelector("wcs-ssr")).toBeNull();
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-for-start");
    expect(html).not.toContain("@@wcs-for-end");

    warnSpy.mockRestore();
  });

  it("for の中に if/else", async () => {
    const { stateEl, warnSpy } = await setupFallback(`
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{
          "users":[
            {"name":"Alice","active":true},
            {"name":"Bob","active":false}
          ]
        }</script>
        <template id="f0" data-wcs="for: users">
          <div class="user">
            <span data-wcs="textContent: users.*.name"></span>
            <template data-wcs="if: users.*.active">
              <span class="badge active">Active</span>
            </template>
            <template data-wcs="else:">
              <span class="badge inactive">Inactive</span>
            </template>
          </div>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"users":[]}'>
      </wcs-state>
      <!--@@wcs-for:f0-->
      <!--@@wcs-for-start:f0:users:0-->
      <div class="user">
        <span data-wcs="textContent: users.*.name">Alice</span>
        <span class="badge active">Active</span>
      </div>
      <!--@@wcs-for-end:f0:users:0-->
      <!--@@wcs-for-start:f0:users:1-->
      <div class="user">
        <span data-wcs="textContent: users.*.name">Bob</span>
        <span class="badge inactive">Inactive</span>
      </div>
      <!--@@wcs-for-end:f0:users:1-->
    `);

    const users = document.querySelectorAll(".user");
    expect(users.length).toBe(2);

    const names = document.querySelectorAll(".user span[data-wcs]");
    expect(names[0].textContent).toBe("Alice");
    expect(names[1].textContent).toBe("Bob");

    // active/inactive バッジが正しく表示されている
    expect(document.querySelectorAll(".badge.active").length).toBe(1);
    expect(document.querySelectorAll(".badge.inactive").length).toBe(1);

    expect(document.querySelector("wcs-ssr")).toBeNull();
    warnSpy.mockRestore();
  });

  it("for の中に if/elseif/else", async () => {
    const { stateEl, warnSpy } = await setupFallback(`
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{
          "items":[
            {"type":"a","label":"Alpha"},
            {"type":"b","label":"Beta"},
            {"type":"c","label":"Gamma"}
          ]
        }</script>
        <template id="f0" data-wcs="for: items">
          <div class="item">
            <template data-wcs="if: items.*.type|eq(a)">
              <span class="type-a" data-wcs="textContent: items.*.label"></span>
            </template>
            <template data-wcs="elseif: items.*.type|eq(b)">
              <span class="type-b" data-wcs="textContent: items.*.label"></span>
            </template>
            <template data-wcs="else:">
              <span class="type-other" data-wcs="textContent: items.*.label"></span>
            </template>
          </div>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":[]}'>
      </wcs-state>
      <!--@@wcs-for:f0-->
      <!--@@wcs-for-start:f0:items:0-->
      <div class="item"><span class="type-a" data-wcs="textContent: items.*.label">Alpha</span></div>
      <!--@@wcs-for-end:f0:items:0-->
      <!--@@wcs-for-start:f0:items:1-->
      <div class="item"><span class="type-b" data-wcs="textContent: items.*.label">Beta</span></div>
      <!--@@wcs-for-end:f0:items:1-->
      <!--@@wcs-for-start:f0:items:2-->
      <div class="item"><span class="type-other" data-wcs="textContent: items.*.label">Gamma</span></div>
      <!--@@wcs-for-end:f0:items:2-->
    `);

    expect(document.querySelectorAll(".item").length).toBe(3);
    expect(document.querySelector(".type-a")?.textContent).toBe("Alpha");
    expect(document.querySelector(".type-b")?.textContent).toBe("Beta");
    expect(document.querySelector(".type-other")?.textContent).toBe("Gamma");

    expect(document.querySelector("wcs-ssr")).toBeNull();
    warnSpy.mockRestore();
  });

  it("if/elseif/else の中に if/elseif/else", async () => {
    const { stateEl, warnSpy } = await setupFallback(`
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{"mode":"a","sub":"x"}</script>
        <template id="i0" data-wcs="if: mode|eq(a)">
          <div class="mode-a">
            <template data-wcs="if: sub|eq(x)">
              <span class="sub-x">A-X</span>
            </template>
            <template data-wcs="elseif: sub|eq(y)">
              <span class="sub-y">A-Y</span>
            </template>
            <template data-wcs="else:">
              <span class="sub-other">A-other</span>
            </template>
          </div>
        </template>
        <template id="i1" data-wcs="elseif: mode|eq(b)">
          <div class="mode-b">B</div>
        </template>
        <template id="i2" data-wcs="else:">
          <div class="mode-other">Other</div>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"mode":"","sub":""}'>
      </wcs-state>
      <!--@@wcs-if:i0-->
      <!--@@wcs-if-start:i0:mode-->
      <div class="mode-a"><span class="sub-x">A-X</span></div>
      <!--@@wcs-if-end:i0:mode-->
      <!--@@wcs-elseif:i1-->
      <!--@@wcs-else:i2-->
    `);

    // mode=a, sub=x なので mode-a + sub-x が表示
    expect(document.querySelector(".mode-a")).not.toBeNull();
    expect(document.querySelector(".sub-x")?.textContent).toBe("A-X");
    expect(document.querySelector(".mode-b")).toBeNull();
    expect(document.querySelector(".mode-other")).toBeNull();

    expect(document.querySelector("wcs-ssr")).toBeNull();
    const html = document.body.innerHTML;
    expect(html).not.toContain("@@wcs-if-start");
    expect(html).not.toContain("@@wcs-if-end");

    warnSpy.mockRestore();
  });

  it("if/elseif/else の中に if/elseif/else の中に if/elseif/else（3段ネスト）", async () => {
    const { stateEl, warnSpy } = await setupFallback(`
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{"a":true,"b":true,"c":true}</script>
        <template id="i0" data-wcs="if: a">
          <div class="level1">
            <template data-wcs="if: b">
              <div class="level2">
                <template data-wcs="if: c">
                  <span class="level3">A-B-C</span>
                </template>
                <template data-wcs="else:">
                  <span class="level3-else">A-B-!C</span>
                </template>
              </div>
            </template>
            <template data-wcs="else:">
              <div class="level2-else">A-!B</div>
            </template>
          </div>
        </template>
        <template id="i1" data-wcs="else:">
          <div class="level1-else">!A</div>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"a":false,"b":false,"c":false}'>
      </wcs-state>
      <!--@@wcs-if:i0-->
      <!--@@wcs-if-start:i0:a-->
      <div class="level1">
        <div class="level2">
          <span class="level3">A-B-C</span>
        </div>
      </div>
      <!--@@wcs-if-end:i0:a-->
      <!--@@wcs-else:i1-->
    `);

    // a=true, b=true, c=true → 3段すべてマッチ
    expect(document.querySelector(".level1")).not.toBeNull();
    expect(document.querySelector(".level2")).not.toBeNull();
    expect(document.querySelector(".level3")?.textContent).toBe("A-B-C");

    // else 側は非表示
    expect(document.querySelector(".level1-else")).toBeNull();
    expect(document.querySelector(".level2-else")).toBeNull();
    expect(document.querySelector(".level3-else")).toBeNull();

    expect(document.querySelector("wcs-ssr")).toBeNull();
    warnSpy.mockRestore();
  });

  it("if/elseif/else の中に for", async () => {
    const { stateEl, warnSpy } = await setupFallback(`
      <wcs-ssr name="default" version="99.0.0">
        <script type="application/json">{
          "showList":true,
          "items":[{"name":"X"},{"name":"Y"},{"name":"Z"}]
        }</script>
        <template id="i0" data-wcs="if: showList">
          <div class="list-container">
            <template data-wcs="for: items">
              <span class="item" data-wcs="textContent: items.*.name"></span>
            </template>
          </div>
        </template>
        <template id="i1" data-wcs="elseif: items.length">
          <div class="count-only">データあり</div>
        </template>
        <template id="i2" data-wcs="else:">
          <div class="empty">データなし</div>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"showList":false,"items":[]}'>
      </wcs-state>
      <!--@@wcs-if:i0-->
      <!--@@wcs-if-start:i0:showList-->
      <div class="list-container">
        <span class="item" data-wcs="textContent: items.*.name">X</span>
        <span class="item" data-wcs="textContent: items.*.name">Y</span>
        <span class="item" data-wcs="textContent: items.*.name">Z</span>
      </div>
      <!--@@wcs-if-end:i0:showList-->
      <!--@@wcs-elseif:i1-->
      <!--@@wcs-else:i2-->
    `);

    // showList=true なので list-container が表示
    expect(document.querySelector(".list-container")).not.toBeNull();

    // for が再構築されている
    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe("X");
    expect(items[1].textContent).toBe("Y");
    expect(items[2].textContent).toBe("Z");

    // else 側は非表示
    expect(document.querySelector(".count-only")).toBeNull();
    expect(document.querySelector(".empty")).toBeNull();

    expect(document.querySelector("wcs-ssr")).toBeNull();
    warnSpy.mockRestore();
  });
});
