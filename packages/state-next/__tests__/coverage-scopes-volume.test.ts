/**
 * Volumes (`<wcs-state mount="p">`, src/scopes/volume.ts): the chroot `this`, lifecycle callbacks,
 * deep mount paths, class-instance states and the load / connect orders scopes.test.ts leaves out.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes]);
  bootstrapState();
});

/** A shadow root with `html`; states handed to the <wcs-state> elements in document order (null: none yet). */
async function host(html: string, states: (Record<string, any> | null)[]) {
  const h = document.createElement(`cov-volume-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const els = Array.from(root.querySelectorAll("wcs-state")) as any[];
  els.forEach((el, i) => { if (states[i] != null) el.setInitialState(states[i]); });
  document.body.appendChild(h);
  const rootEl = els.find((el) => !el.hasAttribute("mount"));
  const settle = async () => {
    await Promise.all(els.map((el) => el.connectedCallbackPromise));
    await getBindingsReady(root);
    await flush();
  };
  const write = async (fn: (s: any) => void) => {
    rootEl.createState("writable", fn);
    await flush();
  };
  const read = (path: string) => {
    let v: unknown;
    rootEl.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { h, root, els, rootEl, settle, write, read };
}

const text = (root: ShadowRoot, sel: string) => root.querySelector(sel)!.textContent;

describe("volume の this（chroot）", () => {
  it("$eqPath は 2 つのパスとも、$untracked のようなパスを取らない $ API はそのまま、シンボルのキーは読めず書けない", async () => {
    const { root, settle, write, read } = await host(
      `<wcs-state></wcs-state><wcs-state mount="v"></wcs-state><p>{{ v.isMine }}</p>`,
      [{}, {
        selected: "a",
        mine: "b",
        count: 3,
        get isMine() { return (this as any).$eqPath("selected", "mine"); },
        probe(this: any) {
          let written: string;
          try {
            this[Symbol("k")] = 1;
            written = "written";
          } catch (e) {
            written = (e as Error).constructor.name;
          }
          return { iterator: this[Symbol.iterator], untracked: this.$untracked(() => this.count), written };
        },
      }],
    );
    await settle();
    expect(text(root, "p")).toBe("false");
    // "selected" / "mine" are the volume's: v.selected / v.mine on the root tree
    await write((s) => { s["v.selected"] = "b"; });
    expect(text(root, "p")).toBe("true");
    const probed = (read("v.probe") as () => any)();
    expect(probed).toEqual({ iterator: undefined, untracked: 3, written: "TypeError" });
  });

  it("$connectedCallback の失敗（同期の例外・拒否された Promise）は console.error に報告され、接ぎ木は保たれる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const thrown = new Error("sync failure");
    const rejected = new Error("async failure");
    try {
      const { settle, read } = await host(
        `<wcs-state></wcs-state><wcs-state mount="a"></wcs-state><wcs-state mount="b"></wcs-state>`,
        [{}, { x: 1, $connectedCallback() { throw thrown; } }, { y: 2, async $connectedCallback() { throw rejected; } }],
      );
      await settle();
      await flush();
      expect(error).toHaveBeenCalledWith(thrown);
      expect(error).toHaveBeenCalledWith(rejected);
      expect(read("a.x")).toBe(1);
      expect(read("b.y")).toBe(2);
    } finally {
      error.mockRestore();
    }
  });
});

describe("volume の接ぎ木", () => {
  it("深いマウントパスの途中が根に無ければ作り、クラスのインスタンスの状態は継承したメソッドと accessor（setter だけのものも）を持ち込む", async () => {
    class Base {
      greet() { return "base"; }
    }
    class Volume extends Base {
      x = 1;
      override greet() { return `volume:${(this as any).x}`; }
      get double() { return this.x * 2; }
      set double(v: number) { this.x = v / 2; }
      set reset(v: number) { this.x = v; }
    }
    const { root, settle, write, read } = await host(
      `<wcs-state></wcs-state><wcs-state mount="a.b"></wcs-state><p>{{ a.b.x }}/{{ a.b.double }}</p>`,
      [{}, new Volume()],
    );
    await settle();
    expect(text(root, "p")).toBe("1/2");
    // the intermediate object was created on the root tree, holding the volume's data only
    expect(Object.keys(read("a") as object)).toEqual(["b"]);
    expect(Object.keys(read("a.b") as object).sort()).toEqual(["greet", "x"]);
    // the subclass's method, not the base's; `this` is the chroot
    expect((read("a.b.greet") as () => string)()).toBe("volume:1");
    await write((s) => { s["a.b.double"] = 10; });
    expect(text(root, "p")).toBe("5/10");
    // a setter without a getter: written through the chroot, read as no data
    await write((s) => { s["a.b.reset"] = 7; });
    expect(text(root, "p")).toBe("7/14");
    expect(read("a.b.reset")).toBeUndefined();
  });

  it("同じ根に 2 つの volume が接ぎ木され、根の再セットは両方のパスを挙げて投げる", async () => {
    const { settle, read, rootEl } = await host(
      `<wcs-state></wcs-state><wcs-state mount="p"></wcs-state><wcs-state mount="q"></wcs-state>`,
      [{}, { a: 1 }, { b: 2 }],
    );
    await settle();
    expect(read("p.a")).toBe(1);
    expect(read("q.b")).toBe(2);
    expect(() => rootEl.setInitialState({})).toThrow("grafted volumes (p, q)");
  });

  it("根より先に置いた 2 つの volume は、どちらも根ができた時点で接ぎ木される", async () => {
    const { root, settle } = await host(
      `<wcs-state mount="p"></wcs-state><wcs-state mount="q"></wcs-state><wcs-state></wcs-state><p>{{ p.a }}+{{ q.b }}</p>`,
      [{ a: 1 }, { b: 2 }, {}],
    );
    await settle();
    expect(text(root, "p")).toBe("1+2");
  });
});

describe("volume のライフサイクル", () => {
  it("接ぎ木の前の切断・再接続では何も呼ばず、切断中の接ぎ木は $connectedCallback を呼ばず、接ぎ木の後の再接続・切断で呼ぶ", async () => {
    const calls: string[] = [];
    const { root, els } = await host(
      `<wcs-state mount="v"></wcs-state><wcs-state></wcs-state>`,
      [{
        n: 1,
        $connectedCallback(this: any) { calls.push(`connected:${this.n}`); },
        $disconnectedCallback(this: any) { calls.push(`disconnected:${this.n}`); },
      }, null],
    );
    const [volume, rootEl] = els;
    await flush();
    await flush();
    // the volume loaded and waits for its root's engine (the root has no state yet)
    volume.remove();
    root.appendChild(volume);
    volume.remove();
    expect(calls).toEqual([]);
    rootEl.setInitialState({});
    await rootEl.connectedCallbackPromise;
    await volume.connectedCallbackPromise;
    // grafted while its element was out of the page
    let n: unknown;
    rootEl.createState("readonly", (s: any) => { n = s["v.n"]; });
    expect(n).toBe(1);
    expect(calls).toEqual([]);
    root.appendChild(volume);
    volume.remove();
    expect(calls).toEqual(["connected:1", "disconnected:1"]);
  });
});
