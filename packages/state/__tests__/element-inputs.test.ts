/**
 * element-inputs.test.ts — what the diagnostics add-on says about a binding to a custom element's member
 * (the music-room seam app, docs/seam-apps.md): a member the element does not declare (#38, with the lint's
 * code `wcs/tag-member-unknown` and the tag).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, diagnostics, getBindingsReady, installFeatures } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([diagnostics]);
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`element-inputs-${seq++}`);
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

describe("宣言されていないメンバーへの束縛（#38 / wcs/tag-member-unknown）", () => {
  it("lint と同じ code とタグを名指し、属性の書き方と lint の案内が付く", async () => {
    customElements.define("ei-env", class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, inputs: [{ name: "attack" }] };
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let message = "";
    try {
      await page(`<ei-env data-wcs="out: envOut"></ei-env>`, { envOut: "filter" });
    } catch (e) {
      message = (e as Error).message;
    } finally {
      error.mockRestore();
    }
    expect(message).toBe(
      '[@wcstack/state] [wcs/tag-member-unknown] "out" is not a wcBindable member of <ei-env>. Bind a property or an input its static wcBindable declares; an attribute of the tag is written in the markup (out="…") or bound as attr.out:. Validate statically: npx @wcstack/lint <file>.',
    );
  });
});
