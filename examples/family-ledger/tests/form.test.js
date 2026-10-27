// The entry form shows the server's field errors next to each field — headless (no browser).
// The page's real state (public/state.js, with its import of ./lib.js) is mounted with `resolveModule`.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mount, settle, fire } from "@wcstack/testing";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
const formMarkup = html.slice(html.indexOf("<!-- form:start -->"), html.indexOf("<!-- form:end -->"));

// <wcs-state src="state.js"> names http://localhost/state.js under happy-dom: the file is in public/.
const resolveModule = (url) => join(PUBLIC, url.pathname);

let app;
afterEach(() => app?.unmount());

async function open(writes = {}) {
  app = await mount(`<wcs-state src="state.js"></wcs-state>${formMarkup}`, { resolveModule });
  await app.state().write((s) => {
    s.routeName = "entry-new";
    s.session = { token: "t", expiresAt: "2999-01-01T00:00:00Z", user: { id: 1, name: "母" } };
    s["categoriesFetch.value"] = [{ id: "food", name: "食費", color: "#000" }, { id: "fun", name: "娯楽", color: "#111" }];
    for (const [k, v] of Object.entries(writes)) s[k] = v;
  });
  await settle();
  return app.root;
}
const errorOf = (root, field) => root.querySelector(`[name=${field}]`).closest("label").querySelector(".field-error").textContent;

describe("記録のフォーム", () => {
  it("最初はどの欄にもエラーが無い", async () => {
    const root = await open();
    expect(root.querySelector("h1").textContent).toBe("記録を追加");
    for (const f of ["date", "amount", "categoryId", "memo"]) expect(errorOf(root, f)).toBe("");
  });

  it("422 のエラーはそれぞれの欄の隣に出る", async () => {
    const root = await open();
    const body = JSON.stringify({ errors: { amount: "金額は整数で入力してください", date: "日付が正しくありません" } });
    await app.state().write((s) => { s.onSaveError({ status: 422, statusText: "Unprocessable Entity", body }); });
    await settle();
    expect(errorOf(root, "amount")).toBe("金額は整数で入力してください");
    expect(errorOf(root, "date")).toBe("日付が正しくありません");
    expect(errorOf(root, "memo")).toBe("");
    expect(errorOf(root, "categoryId")).toBe("");
    expect(root.querySelector("[name=amount]").classList.contains("invalid")).toBe(true);
    expect(root.querySelector("[name=memo]").classList.contains("invalid")).toBe(false);
  });

  it("次に保存しようとするとエラーは消える", async () => {
    const root = await open();
    const body = JSON.stringify({ errors: { amount: "金額を入力してください" } });
    await app.state().write((s) => { s.onSaveError({ status: 422, body }); });
    await settle();
    expect(errorOf(root, "amount")).toBe("金額を入力してください");
    await app.state().write((s) => { s["form.amount"] = "100"; s.save(); });
    await settle();
    expect(errorOf(root, "amount")).toBe("");
  });

  it("409 はサーバーの内容を見せ、ほかの失敗は文で伝える", async () => {
    const root = await open({ routeName: "entry-edit", routeParams: { id: 8 } });
    const current = { id: 8, date: "2026-10-05", amount: 1280, memo: "母が編集", categoryId: "food", version: 2, createdBy: { id: 1, name: "母" } };
    await app.state().write((s) => { s.onSaveError({ status: 409, body: JSON.stringify({ error: "conflict", current }) }); });
    await settle();
    expect(root.querySelector(".conflict").textContent).toContain("母が編集");
    await app.state().write((s) => { s.onSaveError({ status: 500, body: "{}" }); });
    await settle();
    expect(root.querySelector("p.error").textContent).toContain("500");
  });

  it("入力は state に書かれる（双方向の束縛）", async () => {
    const root = await open();
    const input = root.querySelector("[name=amount]");
    input.value = "777";
    fire(input, "input");
    await settle();
    expect(app.state().read((s) => s["form.amount"])).toBe("777");
  });
});
