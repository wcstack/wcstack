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
    // methods live on their paths like the accessors, not in the data (a snapshot or a write of the mount path keeps them)
    expect(Object.keys(read("a.b") as object)).toEqual(["x"]);
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

describe("取り除かれた根", () => {
  it("文書から取り除かれた根の engine には接ぎ木せず、後から接続された新しい根に接ぎ木する（3.x と同じ）", async () => {
    document.body.innerHTML = `<wcs-state json='{"count": 1}'></wcs-state>`;
    const old = document.body.querySelector("wcs-state") as any;
    await old.connectedCallbackPromise;
    await getBindingsReady(document);
    // the old root leaves; the volume comes before the new root in document order
    document.body.innerHTML = `
      <wcs-state mount="cfg" json='{"flag": true}'></wcs-state>
      <wcs-state json='{"count": 7}'></wcs-state>
      <p id="flag">{{ cfg.flag }}</p>
    `;
    const [volume, rootEl] = Array.from(document.body.querySelectorAll("wcs-state")) as any[];
    await Promise.all([volume.connectedCallbackPromise, rootEl.connectedCallbackPromise]);
    await getBindingsReady(document);
    await flush();
    let flag: unknown;
    rootEl.createState("readonly", (s: any) => { flag = s["cfg.flag"]; });
    expect(flag).toBe(true);
    expect(document.getElementById("flag")!.textContent).toBe("true");
    // nothing was grafted onto the old root's engine
    expect(old.engine.target).not.toHaveProperty("cfg");
    document.body.innerHTML = "";
  });

  it("取り除かれた根に接ぎ木された volume はマウントパスを持ち続けず、次のページの同じパスの volume が接ぎ木される", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      document.body.innerHTML = `<wcs-state json='{}'></wcs-state><wcs-state mount="cfg" json='{"flag": 1}'></wcs-state>`;
      await Promise.all(Array.from(document.body.querySelectorAll("wcs-state"), (el: any) => el.connectedCallbackPromise));
      document.body.innerHTML = `<wcs-state json='{}'></wcs-state><wcs-state mount="cfg" json='{"flag": 2}'></wcs-state><p>{{ cfg.flag }}</p>`;
      const els = Array.from(document.body.querySelectorAll("wcs-state")) as any[];
      await Promise.all(els.map((el) => el.connectedCallbackPromise));
      await getBindingsReady(document);
      await flush();
      expect(document.body.querySelector("p")!.textContent).toBe("2");
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      document.body.innerHTML = "";
    }
  });

  it("初期化に失敗した根が文書から取り除かれた後は、後から読み込まれた volume は失敗せず新しい根を待って接ぎ木される", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      document.body.innerHTML = `<wcs-state json='{broken'></wcs-state>`;
      const bad = document.body.querySelector("wcs-state") as any;
      await bad.connectedCallbackPromise.catch(() => {});
      await flush();
      expect(error).toHaveBeenCalled();
      error.mockClear();
      document.body.innerHTML = `<wcs-state mount="cfg" json='{"flag": true}'></wcs-state><wcs-state json='{}'></wcs-state><p>{{ cfg.flag }}</p>`;
      const els = Array.from(document.body.querySelectorAll("wcs-state")) as any[];
      await Promise.all(els.map((el) => el.connectedCallbackPromise));
      await getBindingsReady(document);
      await flush();
      expect(document.body.querySelector("p")!.textContent).toBe("true");
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      document.body.innerHTML = "";
    }
  });

  it("根を待ったまま取り除かれた volume は、次のページの同じマウントパスの volume に譲り、古いページの値は接ぎ木されない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // the old page: its root never gets a state, its volume loads and waits
      document.body.innerHTML = `<wcs-state mount="cfg" json='{"flag": "old"}'></wcs-state><wcs-state></wcs-state>`;
      const old = document.body.querySelector("wcs-state[mount]") as any;
      await flush();
      await flush();
      document.body.innerHTML = `<wcs-state mount="cfg" json='{"flag": "new"}'></wcs-state><wcs-state json='{}'></wcs-state><p>{{ cfg.flag }}</p>`;
      const els = Array.from(document.body.querySelectorAll("wcs-state")) as any[];
      await Promise.all(els.map((el) => el.connectedCallbackPromise));
      await getBindingsReady(document);
      await flush();
      expect(document.body.querySelector("p")!.textContent).toBe("new");
      // the old one settled (it yielded), without a report
      await old.connectedCallbackPromise;
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      document.body.innerHTML = "";
    }
  });

  it("状態を読み込む前に取り除かれた volume も譲り、後から状態が来ても接ぎ木しない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      document.body.innerHTML = `<wcs-state mount="cfg"></wcs-state><wcs-state></wcs-state>`;
      const old = document.body.querySelector("wcs-state[mount]") as any;
      await flush();
      document.body.innerHTML = `<wcs-state mount="cfg" json='{"flag": "new"}'></wcs-state><wcs-state json='{}'></wcs-state><p>{{ cfg.flag }}</p>`;
      const els = Array.from(document.body.querySelectorAll("wcs-state")) as any[];
      await Promise.all(els.map((el) => el.connectedCallbackPromise));
      await getBindingsReady(document);
      // its state comes late: it settles and does not graft
      old.setInitialState({ flag: "late" });
      await old.connectedCallbackPromise;
      await flush();
      expect(document.body.querySelector("p")!.textContent).toBe("new");
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      document.body.innerHTML = "";
    }
  });
});
