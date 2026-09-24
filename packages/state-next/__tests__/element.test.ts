import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

async function host(html: string, init?: (el: any) => void) {
  const h = document.createElement(`element-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  init?.(el);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  return { h, root, el };
}

describe("<wcs-state> の状態の読み込みと公開 API", () => {
  it("json 属性から状態を読む", async () => {
    const { root } = await host(`<wcs-state json='{"msg":"hi"}'></wcs-state><p>{{ msg }}</p>`);
    expect(root.querySelector("p")!.textContent).toBe("hi");
  });

  it("接続前の setInitialState を使う", async () => {
    const { root } = await host(`<wcs-state></wcs-state><p>{{ n }}</p>`, (el) => el.setInitialState({ n: 3 }));
    expect(root.querySelector("p")!.textContent).toBe("3");
  });

  it("接続後に setInitialState を待つ", async () => {
    const h = document.createElement(`element-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ n }}</p>`;
    document.body.appendChild(h);
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ n: 7 });
    await el.connectedCallbackPromise;
    expect(root.querySelector("p")!.textContent).toBe("7");
  });

  it("createState('readonly') の中の書き込みは投げる", async () => {
    const { el } = await host(`<wcs-state json='{"n":1}'></wcs-state>`);
    expect(() => el.createState("readonly", (s: any) => { s.n = 2; })).toThrow("This state is readonly.");
    el.createState("writable", (s: any) => { s.n = 2; });
    el.createState("readonly", (s: any) => expect(s.n).toBe(2));
  });

  it("$disconnectedCallback は外したときに同期で呼ばれ、再接続で $connectedCallback が再び呼ばれる", async () => {
    const calls: string[] = [];
    const { h } = await host(`<wcs-state></wcs-state>`, (el) => el.setInitialState({
      $connectedCallback() { calls.push("connected"); },
      $disconnectedCallback() { calls.push("disconnected"); },
    }));
    h.remove();
    expect(calls).toEqual(["connected", "disconnected"]);
    document.body.appendChild(h);
    expect(calls).toEqual(["connected", "disconnected", "connected"]);
  });

  it("$renderedCallback は反映したバインディングのパスと行の添字を受け取る", async () => {
    const seen: [string[], Record<string, number[][]>][] = [];
    const { el } = await host(
      `<wcs-state></wcs-state><p>{{ title }}</p><ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`,
      (e) => e.setInitialState({
        title: "t", items: [{ v: 1 }, { v: 2 }], other: 0,
        $renderedCallback(paths: string[], idx: Record<string, number[][]>) { seen.push([paths, idx]); },
      }),
    );
    el.createState("writable", (s: any) => { s["items.1.v"] = 20; s.other = 1; });
    await flush();
    expect(seen).toEqual([[["items.*.v"], { "items.*.v": [[1]] }]]);
    el.createState("writable", (s: any) => { s.title = "u"; });
    await flush();
    expect(seen[1]).toEqual([["title"], {}]);
  });

  it("$errorCallback が無ければ失敗は console.error に出て、他のバインディングは反映される", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root } = await host(`<wcs-state></wcs-state><p class="a">{{ bad }}</p><p class="b">{{ ok }}</p>`, (el) =>
      el.setInitialState({ ok: "ok", get bad() { throw new Error("boom"); } }));
    expect(root.querySelector(".b")!.textContent).toBe("ok");
    expect(err).toHaveBeenCalledWith(expect.stringContaining('binding "text: bad" failed to apply'), expect.any(Error));
    err.mockRestore();
  });
});
