/**
 * `data-wcs-ignore`（束縛の属性名 + "-ignore"）: その要素も中身も束縛として読まない。ページが書いて
 * いないマークアップ（サーバのテンプレートが埋めた利用者のコンテンツ）を、束縛として読ませないための印
 * （R10 — README「Markup you did not write」、docs/mistake-catalogue.md の "user-content-in-markup"）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, getBindingsReady } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
const BINDER_KEY = Symbol.for("wcstack.binder");
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`ignore-attr-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  return { root, el };
}

describe("data-wcs-ignore", () => {
  it("ページの走査は、印の付いた要素の中の {{ }}・data-wcs・コメント束縛を読まない（外は束ねる）", async () => {
    const calls: string[] = [];
    const { root } = await page(
      `<div class="ugc" data-wcs-ignore><p>{{ secret }}</p><button data-wcs="onclick: wipe">x</button><i><!--@@: secret--></i></div>`
      + `<p class="out">{{ secret }}</p>`,
      { secret: "S", wipe() { calls.push("wiped"); } },
    );
    expect(root.querySelector(".ugc p")!.textContent).toBe("{{ secret }}");
    (root.querySelector(".ugc button") as HTMLElement).click();
    expect(calls).toEqual([]);
    expect(root.querySelector(".ugc i")!.innerHTML).toBe("<!--@@: secret-->");
    expect(root.querySelector(".out")!.textContent).toBe("S");
  });

  it("印の付いた要素自身の data-wcs も読まない", async () => {
    const { root } = await page(`<p class="raw" data-wcs-ignore data-wcs="textContent: secret">raw</p>`, { secret: "S" });
    expect(root.querySelector(".raw")!.textContent).toBe("raw");
  });

  it("一覧の行の中でも、印の付いた要素は読まない", async () => {
    const { root } = await page(
      `<ul><template data-wcs="for: items"><li><span data-wcs-ignore>{{ .name }}</span><b>{{ .name }}</b></li></template></ul>`,
      { items: [{ name: "a" }, { name: "b" }] },
    );
    expect(Array.from(root.querySelectorAll("li span")).map((n) => n.textContent)).toEqual(["{{ .name }}", "{{ .name }}"]);
    expect(Array.from(root.querySelectorAll("li b")).map((n) => n.textContent)).toEqual(["a", "b"]);
  });

  it("後から binder に渡された、印の付いた要素も読まない", async () => {
    const { root, el } = await page(`<p class="out">{{ secret }}</p>`, { secret: "S" });
    const inserted = document.createElement("div");
    inserted.setAttribute("data-wcs-ignore", "");
    inserted.innerHTML = `<p>{{ secret }}</p>`;
    root.appendChild(inserted);
    (globalThis as any)[BINDER_KEY].bind(inserted);
    await flush();
    expect(inserted.querySelector("p")!.textContent).toBe("{{ secret }}");
    el.createState("writable", (s: any) => { s.secret = "T"; });
    await flush();
    expect(root.querySelector(".out")!.textContent).toBe("T");
    expect(inserted.querySelector("p")!.textContent).toBe("{{ secret }}");
  });
});
