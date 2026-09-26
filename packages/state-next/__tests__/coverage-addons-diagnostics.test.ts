import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, diagnostics, recursion, setTrustedTypesPolicy } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  // diagnostics first: its static recursion check runs before the recursion add-on reads the declaration
  installFeatures([diagnostics, recursion]);
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-diag-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  return { root, el };
}

/** The warnings `run` leads to (console.warn, first argument). */
async function warnings(run: () => Promise<unknown>): Promise<string[]> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await run();
    await flush();
    return warn.mock.calls.map((c) => String(c[0]));
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
}

describe("束ねたパスが状態に無い（wcs/binding-path-missing）", () => {
  it("明示の添字は、ある行の中を見て確かめる。途中の accessor の先は確かめない", async () => {
    const got = await warnings(() => page(
      `<p>{{ items.0.nmae }}</p><p>{{ items.0.name }}</p><p>{{ user.info.a }}</p><p>{{ user.only.b }}</p>`,
      {
        items: [{ name: "a" }],
        user: { get info() { return { a: 1 }; }, set only(_v: unknown) {} },
      },
    ));
    expect(got).toEqual([
      '[@wcstack/state] [wcs/binding-path-missing] Bound path "items.0.nmae" does not resolve on the state tree: "nmae" is not declared. Did you mean "name"? Updates to this path will be silently dropped. Validate statically: npx @wcstack/lint <file>.',
    ]);
  });

  it("後から束ねた部分木（binder プロトコル）の新しいパスだけを確かめる", async () => {
    let root!: ShadowRoot;
    const first = await warnings(async () => { ({ root } = await page(`<p>{{ user.name }}</p>`, { user: { name: "a", age: 1 } })); });
    expect(first).toEqual([]);
    const later = await warnings(async () => {
      const div = document.createElement("div");
      div.innerHTML = `<i>{{ user.name }}</i><b>{{ user.aeg }}</b>`;
      root.appendChild(div);
      (globalThis as any)[Symbol.for("wcstack.binder")].bind(div);
      await flush();
    });
    expect(root.querySelector("i")!.textContent).toBe("a");
    expect(later).toHaveLength(1);
    expect(later[0]).toContain('Bound path "user.aeg" does not resolve on the state tree: "aeg" is not declared. Did you mean "age"?');
  });
});

describe("再帰の静的な検査は形の読めない宣言を recursion の add-on に任せる", () => {
  it.each<[unknown, string]>([
    [{}, "exactly one anchor"],
    [{ "nodes.*": 5 }, "must be a non-empty string"],
    [{ nodes: "children.*" }, 'must end with ".*"'],
    [{ "nodes.*": "children" }, 'must end with ".*"'],
  ])("%j は recursion の add-on の [wcs/recursion-declaration-invalid] になる", (decl, message) => {
    const make = () => new Engine({ nodes: [], $recursion: decl }, new DirtyStrategy());
    expect(make).toThrow("[wcs/recursion-declaration-invalid]");
    expect(make).toThrow(message);
  });
});

describe("Trusted Types に止められた HTML の書き込み", () => {
  it("html: の束縛でも innerHTML として報告し、注入したポリシーが TrustedHTML を返さなかったと言う", async () => {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
    Object.defineProperty(Element.prototype, "innerHTML", {
      configurable: true,
      get: desc.get,
      set(this: Element, v: unknown) {
        if (typeof v === "string" && this.id.startsWith("tt")) throw new TypeError("This document requires 'TrustedHTML' assignment.");
        desc.set!.call(this, v);
      },
    });
    (globalThis as any).trustedTypes = {};
    // a policy whose createHTML returns a plain string (not a TrustedHTML)
    setTrustedTypesPolicy({ createHTML: (s: string) => s });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root } = await page(`<div id="tt1" data-wcs="html: a"></div><div id="tt2" data-wcs="html: a"></div><p>{{ b }}</p>`, { a: "<b>x</b>", b: "ok" });
      const reports = err.mock.calls.filter((c) => String(c[0]).includes("was blocked by Trusted Types"));
      expect(reports).toHaveLength(1);
      expect(String(reports[0][0])).toContain('Writing to "innerHTML" was blocked by Trusted Types');
      expect(String(reports[0][0])).toContain("The injected policy's createHTML() did not return a TrustedHTML.");
      expect(reports[0][1]).toEqual({ element: root.getElementById("tt1"), property: "innerHTML" });
      expect(root.querySelector("p")!.textContent).toBe("ok");
    } finally {
      Object.defineProperty(Element.prototype, "innerHTML", desc);
      delete (globalThis as any).trustedTypes;
      setTrustedTypesPolicy(null);
      err.mockRestore();
    }
  });
});
