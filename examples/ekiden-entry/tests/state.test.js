// @vitest-environment happy-dom
// The page's real state file, mounted headlessly with @wcstack/testing (state-binding.md §13).
import { describe, it, expect, afterEach } from "vitest";
import { mount, settle } from "@wcstack/testing";

const resolveModule = (url) => new URL("../public" + url.pathname, import.meta.url);
let app;
afterEach(() => app?.unmount());

const html = `
  <wcs-state src="/state.js"></wcs-state>
  <output id="fee" data-wcs="textContent: feeText"></output>
  <output id="detail" data-wcs="textContent: feeDetail"></output>
  <ol><template data-wcs="for: runners"><li data-wcs="textContent: .leg"></li></template></ol>`;

describe("state.js (headless)", () => {
  it("the fee follows the entry", async () => {
    app = await mount(html, { resolveModule });
    const fee = app.root.querySelector("#fee");
    expect(fee.textContent).toBe("¥0");
    await app.state().write((s) => { s["team.division"] = "高校生"; });
    await settle();
    expect(fee.textContent).toBe("¥8,000");
    await app.state().write((s) => {
      s.runners = s.runners.concat({ id: "x6", name: "", kana: "", kanaTouched: false, birth: "", sex: "", best: "", shirt: "",
        emergencyPhone: "", notes: "", consentId: "", consentName: "", detailsOpen: false });
      s["options.parking"] = 2;
      s["options.lunchJa"] = 1;
    });
    await settle();
    expect(fee.textContent).toBe("¥10,800");
    expect(app.root.querySelector("#detail").textContent).toBe("参加料 ¥8,000 ＋ 補欠 1人 ¥1,000 ＋ 駐車券 ¥1,000 ＋ 弁当 ¥800");
    expect([...app.root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["1区", "2区", "3区", "4区", "5区", "補欠1"]);
  });

  it("a draft from another tab is applied field by field, rows matched by id", async () => {
    app = await mount(html, { resolveModule });
    const before = await app.state().read((s) => s.runners.map((r) => r.id));
    const draft = await app.state().read((s) => JSON.parse(JSON.stringify(s.draft)));
    draft.team.division = "一般";
    draft.runners = draft.runners.slice().reverse();
    draft.runners[0].name = "逆順";
    await app.state().write((s) => { s.draft = draft; });
    await settle();
    const after = await app.state().read((s) => ({ ids: s.runners.map((r) => r.id), first: s["runners.0.name"], division: s["team.division"] }));
    expect(after.ids).toEqual(before.slice().reverse());
    expect(after.first).toBe("逆順");
    expect(after.division).toBe("一般");
    expect(app.root.querySelector("#fee").textContent).toBe("¥12,000");
  });

  it("an unknown draft shape is ignored", async () => {
    app = await mount(html, { resolveModule });
    await app.state().write((s) => { s.draft = { version: 99, team: { name: "x" } }; });
    await settle();
    expect(await app.state().read((s) => s["team.name"])).toBe("");
  });
});
