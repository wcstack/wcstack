// @vitest-environment happy-dom
// The page's state (src/state/app.ts) mounted headlessly with @wcstack/testing: real bindings, no browser.
// The cart is the page's table (a `for:` over <tbody> rows): mount() keeps the <template> in the table.
import { afterEach, describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { mount, settle, fire, type MountedApp } from "@wcstack/testing";
import type { ItemDetail, Reservation } from "../../shared/api.ts";
import type appState from "../../src/state/app.ts";

// <wcs-state src="src/state/app.ts"> resolves to http://localhost/src/state/app.ts under happy-dom: map it to the file.
// (Not `new URL("../..", import.meta.url)`: Vite rewrites a URL built from a literal — the README warns, and it did.)
const root = resolve(import.meta.dirname, "../..");
const resolveModule = (url: URL): string => join(root, url.pathname);

const html = `
  <wcs-state src="src/state/app.ts"></wcs-state>
  <span id="count" data-wcs="textContent: cartCount"></span>
  <span id="deposit" data-wcs="textContent: totalDepositLabel"></span>
  <table class="cart-lines">
    <thead><tr><th>備品</th><th>期間</th><th>数量</th><th>保証金</th><th></th></tr></thead>
    <tbody>
      <template data-wcs="for: cart">
        <tr class="line" data-wcs="class.has-error: .hasError">
          <td><span class="name" data-wcs="textContent: .name"></span><p class="err" data-wcs="textContent: .error"></p></td>
          <td class="period" data-wcs="textContent: .period"></td>
          <td class="num" data-wcs="textContent: .quantity"></td>
          <td class="num" data-wcs="textContent: .depositLabel"></td>
          <td><button type="button" class="rm" data-wcs="onclick: removeLine">削除</button></td>
        </tr>
      </template>
    </tbody>
  </table>
  <span id="unseen" data-wcs="textContent: unseenCount"></span>
  <ol><template data-wcs="for: pendingList"><li class="pending" data-wcs="textContent: .conflict"></li></template></ol>
`;

const item: ItemDetail = { id: 5, name: "プロジェクター", category: "映像・音響", centerId: 1, stock: 2, deposit: 10000, note: null,
  booked: [{ from: "2026-12-05", to: "2026-12-05", quantity: 1 }] };
const line = (itemId: number, from: string, to: string, quantity: number) =>
  ({ itemId, from, to, quantity, itemName: "プロジェクター", centerId: 1, stock: 2, deposit: 10000 });
const res = (id: number, status: Reservation["status"], lines: Reservation["lines"], groupId = "G01"): Reservation =>
  ({ id, groupId, groupName: "町内会", status, lines, purpose: "p", pickupAt: "2026-12-05T09:00", createdAt: `2026-11-0${id}T09:00` });

let app: MountedApp | undefined;
afterEach(() => { app?.unmount(); app = undefined; localStorage.clear(); });

describe("the page state", () => {
  it("adds to the cart from the item page, merges the same item and period, and totals", async () => {
    app = await mount(html, { resolveModule });
    const state = app.state<typeof appState>();
    await state.write((s) => {
      s.nowMs = Date.UTC(2026, 10, 30, 3, 0); // 2026-11-30 in Japan
      s.routeName = "item";
      s.routeParams = { id: 5 };
      s.itemResult = item;
    });
    await settle(); // entering the item route resets the period ($watch on routeName): choose it after
    await state.write((s) => { s.pick = { from: "2026-12-04", to: "2026-12-06", quantity: 1 }; });
    await settle();
    expect(state.read((s) => s.pickFree)).toBe(1);
    await state.write((s) => { s.addToCart(); });
    await state.write((s) => { s.addToCart(); });
    await settle();
    expect(app.root.querySelector("#count")!.textContent).toBe("1");
    expect(state.read((s) => s.addedMessage)).toBe("かごの同じ行に追加しました");
    // capped at what is free on every day of the period
    expect(state.read((s) => s.cart[0]?.quantity)).toBe(1);
    expect(app.root.querySelector(".period")!.textContent).toBe("12/4(金)〜12/6(日)・3日");
    expect(app.root.querySelector("#deposit")!.textContent).toBe("10,000円");
  });

  it("a 422 on the third line stays at that line after the first is deleted", async () => {
    app = await mount(html, { resolveModule });
    const state = app.state<typeof appState>();
    const lines = [1, 2, 3].map((i) => ({ key: `${i}:2026-12-05:2026-12-05`, itemId: i, name: `備品${i}`, centerId: 1, deposit: 0, max: 5, from: "2026-12-05", to: "2026-12-05", quantity: 1 }));
    await state.write((s) => {
      s.cart = lines;
      s.sentKeys = lines.map((l) => l.key);
      s.submitError = { status: 422, statusText: "Unprocessable", body: JSON.stringify({ errors: { "lines.2.quantity": "この期間の空きは0です" } }) };
    });
    await settle();
    const errs = () => [...app!.root.querySelectorAll(".err")].map((e) => e.textContent);
    expect(errs()).toEqual(["", "", "数量: この期間の空きは0です"]);
    expect(app.root.querySelectorAll("tbody tr.line")[2]!.classList.contains("has-error")).toBe(true);
    fire(app.root.querySelectorAll<HTMLButtonElement>(".rm")[0]!, "click");
    await settle();
    expect(errs()).toEqual(["", "数量: この期間の空きは0です"]);
    expect([...app.root.querySelectorAll(".name")].map((e) => e.textContent)).toEqual(["備品2", "備品3"]);
  });

  it("the cart is saved to storage as it changes (what a reload and a second tab read)", async () => {
    app = await mount(html.replace("</wcs-state>", `</wcs-state><wcs-storage key="midori.cart" data-wcs="value#init=element: savedCart"></wcs-storage>`),
      { resolveModule, bootstrap: [async () => (await import("@wcstack/state")).bootstrapState(), async () => (await import("@wcstack/storage")).bootstrapStorage()] });
    const state = app.state<typeof appState>();
    await state.write((s) => {
      s.cart = [{ key: "1:2026-12-05:2026-12-05", itemId: 1, name: "机", centerId: 1, deposit: 0, max: 5, from: "2026-12-05", to: "2026-12-05", quantity: 2 }];
    });
    await settle();
    // one row's quantity, as the stepper's binding writes it (a typed state has no "cart.0.quantity" key)
    await state.write((s) => { s.$update("cart.*.quantity", [0], 4); });
    await settle();
    expect(JSON.parse(localStorage.getItem("midori.cart") ?? "null")[0].quantity).toBe(4);
  });

  it("counts decisions not yet seen, and the /admin stock check", async () => {
    app = await mount(html, { resolveModule });
    const state = app.state<typeof appState>();
    await state.write((s) => {
      s.session = { token: "t", user: { id: "G01", name: "町内会", role: "group" } };
      s.seenIds = [1];
      s.reservations = [res(1, "approved", [line(5, "2026-12-05", "2026-12-06", 1)]), res(2, "denied", []), res(3, "pending", [line(5, "2026-12-05", "2026-12-05", 2)])];
    });
    await settle();
    expect(app.root.querySelector("#unseen")!.textContent).toBe("1");
    expect(app.root.querySelector(".pending")!.textContent).toBe("在庫を超えます: プロジェクター 12/5");
    await state.write((s) => { s.markSeen(); });
    await settle();
    expect(app.root.querySelector("#unseen")!.textContent).toBe("0");
  });
});
