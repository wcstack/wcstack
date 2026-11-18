import { describe, it, expect, expectTypeOf, afterEach } from "vitest";
import { defineState } from "@wcstack/state/define";
import { mount, settle, type MountedApp } from "../src/exports";

/**
 * state<S>(): read / write のコールバックに渡る状態を、defineState の this と同じ型（WcsThis<S>）にする。
 * 型の検査は `npm run typecheck`（tsconfig.test.json）— vitest は型を見ない。
 */

const cartState = defineState({
  cartCount: 0,
  items: [] as { name: string; price: number }[],
  get total(): number {
    return this.items.reduce((sum, item) => sum + item.price, 0);
  },
  add(name: string, price: number): void {
    this.items = [...this.items, { name, price }];
    this.cartCount++;
  },
});

// the page's state, the same definition as an inline module
const PAGE = `
  <wcs-state>
    <script type="module">
      export default {
        cartCount: 0,
        items: [],
        get total() { return this.items.reduce((sum, item) => sum + item.price, 0); },
        add(name, price) { this.items = [...this.items, { name, price }]; this.cartCount++; },
      };
    </script>
  </wcs-state>
  <p id="count" data-wcs="textContent: cartCount"></p>
`;

afterEach(() => {
  document.body.innerHTML = "";
});

/** 型だけの検査（走らせない — 綴りを誤ったキーは実行時には undefined、read の中の書き込みは投げる） */
function typeOnly(app: MountedApp): void {
  const state = app.state<typeof cartState>();
  // @ts-expect-error a misspelt key is a type error
  state.read((s) => s.cartCont);
  // @ts-expect-error read hands a readonly state
  state.read((s) => { s.cartCount = 1; });
  // @ts-expect-error a method's arguments are typed
  void state.write((s) => s.add(1));
  // @ts-expect-error a value of the wrong type
  void state.write((s) => { s.cartCount = "1"; });
}

describe("state<S>() — read / write の状態の型", () => {
  it("state<typeof def>() は read / write に定義の型を渡し、キャスト無しでメソッドを呼べる", async () => {
    const app = await mount(PAGE);
    const state = app.state<typeof cartState>();

    await state.write((s) => {
      expectTypeOf(s.add).parameters.toEqualTypeOf<[string, number]>();
      s.add("apple", 120);
      s.add("pear", 80);
    });
    await settle();

    const count = state.read((s) => s.cartCount);
    expectTypeOf(count).toEqualTypeOf<number>();
    expect(count).toBe(2);
    const total = state.read((s) => s.total);
    expectTypeOf(total).toEqualTypeOf<number>();
    expect(total).toBe(200);
    // dot paths and the $ API, as in a definition's `this`
    const prices = state.read((s) => s.$getAll("items.*.price", []));
    expect(prices).toEqual([120, 80]);
    expectTypeOf(state.read((s) => s["items.*.name"])).toEqualTypeOf<string>();
    expect(app.root.querySelector("#count")!.textContent).toBe("2");
    expect(typeOnly).toBeTypeOf("function");
  });

  it("型を名指さない state() は、これまでどおり any を渡す", async () => {
    const app = await mount(PAGE);
    expectTypeOf(app.state().read((s) => s)).toBeAny();
    await app.state().write((s) => {
      expectTypeOf(s).toBeAny();
      s.cartCount = 5;
    });
    await settle();
    expect(app.state().read((s) => s.cartCount)).toBe(5);
  });
});
