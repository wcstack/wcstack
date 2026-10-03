/**
 * The install order of the add-ons whose hooks depend on it (G5): `element` (ssr's hydrate and the
 * volumes' graft, both at "mounting") and `declare` (scopes' refusal and the runtimes temporal and
 * list-keys replace). quality-addon.test.ts runs these cases in the full build's order — the one in
 * which a hook that depends on the order fails (it detects that); this file runs them in the reverse
 * one, to show they work there too (a split `auto` page installs the add-ons in the order its
 * `features=` names them). In this order the code before the fix passed as well: the detection is
 * quality-addon.test.ts's. (A file of its own: installs accumulate within a file.)
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, listKeys, recursion, scopes, ssr, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([ssr, recursion, scopes, listKeys, temporal]);
  bootstrapState();
});

async function load(html: string, states: Record<string, any>[], server = false) {
  if (server) document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`quality-order-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const els = Array.from(root.querySelectorAll("wcs-state")) as any[];
    els.forEach((el, i) => el.setInitialState(states[i]));
    document.body.appendChild(h);
    await Promise.all(els.map((el) => el.connectedCallbackPromise));
    await getBindingsReady(root);
    await flush();
    if (server) (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
    return { h, root, els };
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
}

describe("ssr を scopes より先に入れた順", () => {
  const volume = () => ({
    n: 1,
    where: "",
    $connectedCallback(this: any) {
      if (document.documentElement.hasAttribute("data-wcs-server")) this.n = 10;
      else this.where = "client";
    },
  });

  it.each([["根が先", true], ["volume が先", false]])("%s: volume はサーバのデータを引き取り、クライアントの $connectedCallback の書き込みが残る（G3）", async (_n, rootFirst) => {
    const vol = `<wcs-state mount="cart"></wcs-state>`;
    const r = `<wcs-state enable-ssr></wcs-state>`;
    const html = `${rootFirst ? r + vol : vol + r}<p>{{ cart.n }}/{{ cart.where }}</p>`;
    const states = (): Record<string, any>[] => (rootFirst ? [{}, volume()] : [volume(), {}]);
    const server = await load(html, states(), true);
    const out = server.root.innerHTML;
    server.h.remove();
    expect(out).toContain(`"cart":{"n":10,"where":""}`);
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
    try {
      const { root } = await load(out, states());
      expect(root.querySelector("p")!.textContent).toBe("10/client");
      expect(errors).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("scopes を temporal・list-keys より先に入れた順", () => {
  it("接ぎ木した volume のある根の再セットを拒んでも、古い状態の $watch と $listKeys は動き続ける（G1(a)）", async () => {
    const calls: unknown[] = [];
    const first = { id: 1, v: "a" };
    const { root, els } = await load(
      `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state><p>{{ count }}</p><ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`,
      [{ count: 0, items: [first], $listKeys: { items: "id" }, $watch: { count(cur: unknown) { calls.push(cur); } } }, { n: 1 }],
    );
    expect(() => els[0].setInitialState({ count: 100, items: [] })).toThrow(/grafted volumes/);
    els[0].createState("writable", (s: any) => { s.count = 2; });
    await flush();
    expect([root.querySelector("p")!.textContent, calls]).toEqual(["2", [2]]);
    els[0].createState("writable", (s: any) => { s.items = [{ id: 1, v: "b" }]; });
    await flush();
    let row: any;
    els[0].createState("readonly", (s: any) => { row = s.items[0]; });
    expect(row).toBe(first);
  });
});
