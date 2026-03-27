import { describe, it, expect } from "vitest";
import { bootstrapState } from "../src/bootstrapState";

beforeAll(() => {
  bootstrapState();
});

describe("ハイドレーション後の再レンダリング", () => {
  it("for: items に追加すると DOM が更新される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[{"name":"Alice"},{"name":"Bob"}]}</script>
        <template id="u0" data-wcs="for: items">
          <li data-wcs="textContent: .name"></li>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <ul>
        <!--@@wcs-for:u0-->
        <!--@@wcs-for-start:u0:items:0--><li data-wcs="textContent: items.*.name">Alice</li><!--@@wcs-for-end:u0:items:0-->
        <!--@@wcs-for-start:u0:items:1--><li data-wcs="textContent: items.*.name">Bob</li><!--@@wcs-for-end:u0:items:1-->
      </ul>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      items: [{ name: "Alice" }, { name: "Bob" }],
    });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // 初期状態
    expect(document.querySelectorAll("li").length).toBe(2);

    // items に追加
    stateEl.createState("writable", (state: any) => {
      state.items = [...state.items, { name: "Charlie" }];
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    const items = document.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(items[2].textContent).toBe("Charlie");
  });

  it("for: items から削除すると DOM が更新される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[{"name":"Alice"},{"name":"Bob"}]}</script>
        <template id="u0" data-wcs="for: items">
          <li data-wcs="textContent: .name"></li>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <ul>
        <!--@@wcs-for:u0-->
        <!--@@wcs-for-start:u0:items:0--><li data-wcs="textContent: items.*.name">Alice</li><!--@@wcs-for-end:u0:items:0-->
        <!--@@wcs-for-start:u0:items:1--><li data-wcs="textContent: items.*.name">Bob</li><!--@@wcs-for-end:u0:items:1-->
      </ul>
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      items: [{ name: "Alice" }, { name: "Bob" }],
    });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // items から削除
    stateEl.createState("writable", (state: any) => {
      state.items = [{ name: "Bob" }];
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    const items = document.querySelectorAll("li");
    expect(items.length).toBe(1);
    expect(items[0].textContent).toBe("Bob");
  });

  it("if: 条件を false にすると DOM が非表示になる", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"show":true}</script>
        <template id="u0" data-wcs="if: show">
          <p class="content">表示中</p>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <!--@@wcs-if:u0-->
      <!--@@wcs-if-start:u0:show--><p class="content">表示中</p><!--@@wcs-if-end:u0:show-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({ show: true });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // 初期状態: 表示
    expect(document.querySelector("p.content")).not.toBeNull();

    // show を false に
    stateEl.createState("writable", (state: any) => {
      state.show = false;
    });
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(document.querySelector("p.content")).toBeNull();
  });

  it("if: 条件を false→true にすると DOM が再表示される", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"show":true}</script>
        <template id="u0" data-wcs="if: show">
          <p class="content">表示中</p>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr name="default"></wcs-state>
      <!--@@wcs-if:u0-->
      <!--@@wcs-if-start:u0:show--><p class="content">表示中</p><!--@@wcs-if-end:u0:show-->
    `;

    const stateEl = document.querySelector("wcs-state") as any;
    stateEl.setInitialState({ show: true });
    await stateEl.connectedCallbackPromise;
    await new Promise(resolve => setTimeout(resolve, 200));

    // false にして非表示
    stateEl.createState("writable", (state: any) => {
      state.show = false;
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(document.querySelector("p.content")).toBeNull();

    // true にして再表示
    stateEl.createState("writable", (state: any) => {
      state.show = true;
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(document.querySelector("p.content")).not.toBeNull();
    expect(document.querySelector("p.content")!.textContent).toBe("表示中");
  });
});
