import { describe, it, expect, afterEach } from "vitest";
import { mount } from "../src/exports";

afterEach(() => {
  document.body.innerHTML = "";
});

const bootstrapRouter = async () => (await import("@wcstack/router")).bootstrapRouter();
const bootstrapState = async () => (await import("@wcstack/state")).bootstrapState();

/**
 * `bootstrap` は既定の `[bootstrapState]` を置き換える。README と skill が「足す」と読める書き方だったので、
 * router だけを並べると `<wcs-state>` は未定義のまま、束縛はどれも書いたままで、mount() は何も言わずに
 * 成功していた（Advent Calendar の制作の記録、docs/v4-direction-2026-10.md §5.27）。
 * このファイルは最初のテストで state を登録しないために独立している。
 */
describe("mount() の bootstrap", () => {
  it("<wcs-state> のあるページで、並べた登録が state を定義しなければ失敗する（直し方を言う）", async () => {
    const html = `<wcs-state json='{"n":1}'></wcs-state><p data-wcs="textContent: n">初期の文字</p>`;
    await expect(mount(html, { bootstrap: [bootstrapRouter] })).rejects.toThrow(
      /the page has a <wcs-state>, but no element is defined under that name.*replaces the default \[bootstrapState\]/,
    );
    expect(customElements.get("wcs-state")).toBeUndefined();
    // the document was not touched
    expect(document.body.innerHTML).toBe("");
  });

  it("<wcs-state> の無いページは、state を並べなくてよい", async () => {
    const app = await mount(`<p id="plain">plain</p>`, { bootstrap: [bootstrapRouter] });
    expect(app.root.querySelector("#plain")?.textContent).toBe("plain");
    expect(customElements.get("wcs-state")).toBeUndefined();
  });

  it("state も並べれば束ねる", async () => {
    const html = `<wcs-state json='{"n":1}'></wcs-state><p data-wcs="textContent: n">初期の文字</p>`;
    const app = await mount(html, { bootstrap: [bootstrapRouter, bootstrapState] });
    expect(app.root.querySelector("p")?.textContent).toBe("1");
  });
});
