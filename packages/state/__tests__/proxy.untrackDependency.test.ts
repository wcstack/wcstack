/**
 * proxy.untrackDependency.test.ts — $untrackDependency と setter 実行中の
 * 依存追跡抑止（onSelect 最適化の基盤）のテスト。
 *
 * - $untrackDependency: スコープ内の読み取りは動的依存を張らない（値は返る）
 * - $1 インデックス依存の記録も untrack 中は抑止される
 * - 例外時もカウンタが復元される（以後の追跡は通常どおり）
 * - setter 実行中は依存追跡が抑止される（setter は命令的代入であって派生ではない。
 *   アクセサペアでは同値ガードの旧値読みが getter の依存として誤登録されるのを防ぐ）
 * - 統合: ベンチ形の選択パターンで「旧・新の 2 行 + selectedIndex」だけが更新される
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";
import { registerUpdateBatchListener, unregisterUpdateBatchListener, UpdateBatchListener } from "../src/updater/updater";
import type { IAbsoluteStateAddress } from "../src/address/types";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
let activeBatchListener: UpdateBatchListener | null = null;
const flush = () => new Promise((r) => setTimeout(r));

afterEach(() => {
  if (activeBatchListener !== null) {
    unregisterUpdateBatchListener(activeBatchListener);
    activeBatchListener = null;
  }
});

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`untrack-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return { host, shadowRoot, stateElement };
}

describe("$untrackDependency", () => {
  it("スコープ内の読み取りは値を返すが動的依存を張らないこと（対照: 通常読みは張る）", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        sel: 0,
        get untracked(this: any) { return "u" + this.$untrackDependency(() => this.sel); },
        get tracked(this: any) { return "t" + this.sel; },
      },
      `<div id="u" data-wcs="textContent: untracked"></div><div id="t" data-wcs="textContent: tracked"></div>`,
    );
    expect(shadowRoot.querySelector("#u")!.textContent).toBe("u0");
    expect(shadowRoot.querySelector("#t")!.textContent).toBe("t0");

    // 動的依存台帳: sel → tracked は登録・sel → untracked は未登録
    const deps = stateElement.dynamicDependency.get("sel") ?? [];
    expect(deps).toContain("tracked");
    expect(deps).not.toContain("untracked");

    // sel を書いても untracked は再評価されない（tracked だけ更新）
    stateElement.createState("writable", (s: any) => { s.sel = 5; });
    await flush();
    expect(shadowRoot.querySelector("#t")!.textContent).toBe("t5");
    expect(shadowRoot.querySelector("#u")!.textContent).toBe("u0");
    host.remove();
  });

  it("戻り値を素通しし、fn が throw してもカウンタが復元されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { n: 1, get d(this: any) { return this.n * 2; } },
      `<div id="d" data-wcs="textContent: d"></div>`,
    );
    stateElement.createState("writable", (s: any) => {
      expect(s.$untrackDependency(() => 42)).toBe(42);
      expect(() => s.$untrackDependency(() => { throw new Error("boom"); })).toThrow(/boom/);
    });
    // throw 後も追跡は通常どおり（依存済みの getter が更新される）
    stateElement.createState("writable", (s: any) => { s.n = 3; });
    await flush();
    expect(shadowRoot.querySelector("#d")!.textContent).toBe("6");
    host.remove();
  });

  it("ネストした untrack スコープでも外側スコープ終了まで抑止が続くこと", async () => {
    const { host, stateElement } = await mount(
      {
        a: 1,
        b: 2,
        get both(this: any) {
          return this.$untrackDependency(() => this.a + this.$untrackDependency(() => this.b));
        },
      },
      `<div data-wcs="textContent: both"></div>`,
    );
    expect(stateElement.dynamicDependency.get("a") ?? []).not.toContain("both");
    expect(stateElement.dynamicDependency.get("b") ?? []).not.toContain("both");
    host.remove();
  });

  it("$1 インデックス依存の記録も untrack 中は抑止されること", async () => {
    const { host, stateElement } = await mount(
      {
        items: [{ v: 1 }, { v: 2 }],
        get "items.*.silent"(this: any) { return this.$untrackDependency(() => this.$1); },
        get "items.*.loud"(this: any) { return this.$1; },
      },
      `<ul><template data-wcs="for: items"><li data-wcs="title: .silent">{{ .loud }}</li></template></ul>`,
    );
    const indexGetters = stateElement.indexDependentGetterPaths!;
    expect(indexGetters.has("items.*.loud")).toBe(true);
    expect(indexGetters.has("items.*.silent")).toBe(false);
    host.remove();
  });
});

describe("setter 実行中の依存追跡抑止", () => {
  it("アクセサペアの setter 内の読み書きが getter の依存として誤登録されないこと", async () => {
    const { host, stateElement } = await mount(
      {
        items: [{ v: 1 }, { v: 2 }, { v: 3 }],
        sel: null,
        get "items.*.on"(this: any) { return this.$1 === this.$untrackDependency(() => this.sel); },
        set "items.*.on"(this: any, value: any) { this.sel = value ? this.$1 : null; },
      },
      `<ul><template data-wcs="for: items"><li data-wcs="class.on: .on">{{ .v }}</li></template></ul>`,
    );
    stateElement.createState("writable", (s: any) => { s["items.1.on"] = true; });
    await flush();
    // setter 内の this.sel 書き込み（同値ガードの旧値読み）が
    // sel → items.*.on の動的依存として登録されてはならない
    expect(stateElement.dynamicDependency.get("sel") ?? []).not.toContain("items.*.on");
    // setter 内の $1 読みも index 依存として記録されない（getter 側の $1 は記録済み）
    expect(stateElement.indexDependentGetterPaths!.has("items.*.on")).toBe(true);
    host.remove();
  });

  it("ベンチ形の選択パターン: 旧・新 2 行と selectedIndex だけが更新されること", async () => {
    const batches: ReadonlySet<IAbsoluteStateAddress>[] = [];
    activeBatchListener = (batch) => { batches.push(batch); };
    registerUpdateBatchListener(activeBatchListener);
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ v: 1 }, { v: 2 }, { v: 3 }],
        sel: null,
        get "items.*.on"(this: any) { return this.$1 === this.$untrackDependency(() => this.sel); },
        set "items.*.on"(this: any, value: any) { this.sel = value ? this.$1 : null; },
        onPick(this: any, _e: Event, $1: number) {
          if (this.sel !== null && this.sel !== $1) this[`items.${this.sel}.on`] = false;
          this[`items.${$1}.on`] = true;
        },
      },
      `<ul><template data-wcs="for: items"><li><a data-wcs="onclick: onPick; class.on: .on">{{ .v }}</a></li></template></ul>`,
    );
    const hasOn = (i: number) => (shadowRoot.querySelectorAll("li a")[i] as HTMLElement).classList.contains("on");

    (shadowRoot.querySelectorAll("li a")[0] as HTMLElement).click();
    await flush();
    expect([hasOn(0), hasOn(1), hasOn(2)]).toEqual([true, false, false]);

    batches.length = 0;
    (shadowRoot.querySelectorAll("li a")[2] as HTMLElement).click();
    await flush();
    expect([hasOn(0), hasOn(1), hasOn(2)]).toEqual([false, false, true]);

    // 更新バッチ: items.0.on（旧行）・items.2.on（新行）・sel の 3 アドレスだけ。
    // items.1.on（無関係行）への展開が無い＝O(全行) 展開が消えている
    const all = new Set<string>();
    for (const batch of batches) {
      for (const addr of batch) {
        all.add(addr.absolutePathInfo.pathInfo.path + "#" + (addr.listIndex?.index ?? ""));
      }
    }
    expect(all.has("items.*.on#0")).toBe(true);
    expect(all.has("items.*.on#2")).toBe(true);
    expect(all.has("items.*.on#1")).toBe(false);
    expect(all.has("sel#")).toBe(true);
    expect(all.size).toBe(3);
    host.remove();
  });

  it("swap 後も選択位置の getter が正しく再評価されること（$1 は追跡維持）", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ v: 1 }, { v: 2 }, { v: 3 }],
        sel: null,
        get "items.*.on"(this: any) { return this.$1 === this.$untrackDependency(() => this.sel); },
        set "items.*.on"(this: any, value: any) { this.sel = value ? this.$1 : null; },
        onPick(this: any, _e: Event, $1: number) {
          if (this.sel !== null && this.sel !== $1) this[`items.${this.sel}.on`] = false;
          this[`items.${$1}.on`] = true;
        },
      },
      `<ul><template data-wcs="for: items"><li><a data-wcs="onclick: onPick; class.on: .on">{{ .v }}</a></li></template></ul>`,
    );
    const rows = () => Array.from(shadowRoot.querySelectorAll("li a")).map(
      (a) => a.textContent + (a.classList.contains("on") ? "*" : ""),
    );
    (shadowRoot.querySelectorAll("li a")[0] as HTMLElement).click();
    await flush();
    expect(rows()).toEqual(["1*", "2", "3"]);

    // swap: 行 0 と行 2 を入れ替え（選択は位置 0 のまま = 新しく位置 0 に来た行が選択表示）
    stateElement.createState("writable", (s: any) => {
      const arr = s.items.slice();
      [arr[0], arr[2]] = [arr[2], arr[0]];
      s.items = arr;
    });
    await flush();
    expect(rows()).toEqual(["3*", "2", "1"]);
    host.remove();
  });
});
