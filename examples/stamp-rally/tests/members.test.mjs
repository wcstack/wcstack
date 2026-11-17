// @vitest-environment happy-dom
// The contact → member merge through a real <wcs-state>, headless (@wcstack/testing, as the state README suggests).
import { describe, it, expect } from "vitest";
import { mount, settle, fire } from "@wcstack/testing";

const resolveModule = (url) => new URL("./fixtures" + url.pathname, import.meta.url);

describe("members from the contact picker, in a mounted state", () => {
  it("adds only the contact whose address is new, and renders the rows", async () => {
    const app = await mount(`
      <wcs-state src="./members-state.js"></wcs-state>
      <ul><template data-wcs="for: members"><li data-wcs="textContent: .email"></li></template></ul>
      <p class="count" data-wcs="textContent: count"></p>
      <button data-wcs="onclick: merge">merge</button>
      <p class="msg" data-wcs="textContent: message"></p>`, { resolveModule });
    expect(app.root.querySelector(".count").textContent).toBe("1");
    await app.state().write((s) => {
      s.picked = [{ name: ["Hanako"], email: ["HANAKO@example.jp"] }, { name: [], email: ["taro@example.jp"] }];
    });
    fire(app.root.querySelector("button"), "click");
    await settle();
    expect(app.root.querySelector(".count").textContent).toBe("2");
    expect([...app.root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["hanako@example.jp", "taro@example.jp"]);
    expect(app.root.querySelector(".msg").textContent).toBe("1人を加えました");
    app.unmount();
  });
});
