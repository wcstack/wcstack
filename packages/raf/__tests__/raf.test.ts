import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Raf } from "../src/components/Raf";
import { RafCore } from "../src/core/RafCore";
import { registerComponents } from "../src/registerComponents";
import { FakeScheduler, installGlobalRafMock, setVisibility, resetVisibility } from "./helpers";

registerComponents();

let scheduler: FakeScheduler;
let uninstall: () => void;

beforeEach(() => {
  scheduler = new FakeScheduler();
  // Shell は自前の RafCore を注入なしで構築するため、グローバル rAF を
  // モックして呼び出し時解決（§3.7）ごと検証する。
  uninstall = installGlobalRafMock(scheduler);
});

afterEach(() => {
  document.body.innerHTML = "";
  uninstall();
  resetVisibility();
});

function createRaf(attrs: Record<string, string> = {}): Raf {
  const el = document.createElement("wcs-raf") as Raf;
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  document.body.appendChild(el);
  return el;
}

describe("Raf: 登録と接続", () => {
  it("registerComponents は多重呼び出しでも安全", () => {
    expect(() => registerComponents()).not.toThrow();
    expect(customElements.get("wcs-raf")).toBe(Raf);
  });

  it("接続で自動 start し、display:none になる", () => {
    const el = createRaf();
    expect(el.running).toBe(true);
    expect(el.style.display).toBe("none");
    expect(scheduler.pending).toBe(1);
  });

  it("manual 属性ありでは自動 start しない", () => {
    const el = createRaf({ manual: "" });
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);
  });

  it("connectedCallbackPromise は resolve する（SSR 契約）", async () => {
    const el = createRaf({ manual: "" });
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    expect((el.constructor as typeof Raf).hasConnectedCallbackPromise).toBe(true);
  });

  it("切断で dispose され、保留フレームが発火しても tick は進まない", () => {
    const el = createRaf();
    scheduler.pump(1000);
    expect(el.tick).toBe(1);
    el.remove();
    expect(el.running).toBe(false);
    scheduler.pump(2000);
    expect(el.tick).toBe(1);
  });

  it("remove → 再 appendChild で loop が再開し、suspended も追随し、初回 dt は 0 になる", () => {
    const el = createRaf();
    scheduler.pump(1000);
    scheduler.pump(1016);
    expect(el.tick).toBe(2);
    expect(el.dt).toBe(16);
    el.remove();
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);

    document.body.appendChild(el);
    expect(el.running).toBe(true);
    expect(scheduler.pending).toBe(1);
    scheduler.pump(9000);
    // tick/elapsed は dispose() をまたいで保持され、初回フレームの dt は
    // 中断を跨がない（G3）。
    expect(el.tick).toBe(3);
    expect(el.dt).toBe(0);

    // suspended も再接続時の observe() 経由で visibility に追随し直す。
    setVisibility("hidden");
    expect(el.suspended).toBe(true);
    setVisibility("visible");
    expect(el.suspended).toBe(false);
  });
});

describe("Raf: フレームと委譲 getter", () => {
  it("tick/elapsed/dt を Core から委譲して返す", () => {
    const el = createRaf();
    scheduler.pump(1000);
    scheduler.pump(1016);
    expect(el.tick).toBe(2);
    expect(el.dt).toBe(16);
    expect(el.elapsed).toBe(16);
  });

  it("wcs-raf:tick は要素からバブルする", () => {
    createRaf();
    const details: unknown[] = [];
    document.body.addEventListener("wcs-raf:tick", (e) => details.push((e as CustomEvent).detail));
    scheduler.pump(1000);
    expect(details).toEqual([{ count: 1, elapsed: 0, dt: 0, timestamp: 1000 }]);
  });

  it("suspended は接続時の observe() 経由で visibility に追随する", () => {
    const el = createRaf();
    expect(el.suspended).toBe(false);
    setVisibility("hidden");
    expect(el.suspended).toBe(true);
    setVisibility("visible");
    expect(el.suspended).toBe(false);
  });
});

describe("Raf: once / repeat 属性", () => {
  it("once は 1 フレームで自動停止する（repeat=1 の糖衣）", () => {
    const el = createRaf({ once: "" });
    scheduler.pump(1000);
    expect(el.tick).toBe(1);
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);
  });

  it("repeat=N は N フレームで停止する", () => {
    const el = createRaf({ repeat: "3" });
    scheduler.pump(1000);
    scheduler.pump(1016);
    expect(el.running).toBe(true);
    scheduler.pump(1032);
    expect(el.running).toBe(false);
    expect(el.tick).toBe(3);
  });

  it("once と repeat が両方あるときは repeat が優先される", () => {
    const el = createRaf({ once: "", repeat: "2" });
    scheduler.pump(1000);
    expect(el.running).toBe(true);
    scheduler.pump(1016);
    expect(el.running).toBe(false);
    expect(el.tick).toBe(2);
  });

  it("repeat 属性の不正値は 0（無制限）に正規化される", () => {
    const el = createRaf({ manual: "" });
    expect(el.repeat).toBe(0);
    el.setAttribute("repeat", "abc");
    expect(el.repeat).toBe(0);
    el.setAttribute("repeat", "-2");
    expect(el.repeat).toBe(0);
    el.setAttribute("repeat", "  ");
    expect(el.repeat).toBe(0);
    el.setAttribute("repeat", "3px");
    expect(el.repeat).toBe(0);
    el.setAttribute("repeat", "5");
    expect(el.repeat).toBe(5);
  });

  it("once / repeat / manual のアクセサは属性とラウンドトリップする", () => {
    const el = createRaf({ manual: "" });
    el.once = true;
    expect(el.hasAttribute("once")).toBe(true);
    expect(el.once).toBe(true);
    el.once = false;
    expect(el.hasAttribute("once")).toBe(false);

    el.repeat = 4;
    expect(el.getAttribute("repeat")).toBe("4");
    expect(el.repeat).toBe(4);

    expect(el.manual).toBe(true);
    el.manual = false;
    expect(el.hasAttribute("manual")).toBe(false);
    el.manual = true;
    expect(el.hasAttribute("manual")).toBe(true);
  });
});

describe("Raf: コマンドと trigger", () => {
  it("start/stop/reset/pause/resume が Core に委譲される", () => {
    const el = createRaf({ manual: "" });
    el.start();
    expect(el.running).toBe(true);
    scheduler.pump(1000);
    scheduler.pump(1016);
    el.pause();
    expect(el.running).toBe(false);
    el.resume();
    expect(el.running).toBe(true);
    scheduler.pump(5000);
    expect(el.dt).toBe(0);
    el.stop();
    expect(el.running).toBe(false);
    el.reset();
    expect(el.tick).toBe(0);
    expect(el.elapsed).toBe(0);
  });

  it("trigger の false→true 書き込みで start し、trigger-changed(false) が発火する", () => {
    const el = createRaf({ manual: "" });
    const details: unknown[] = [];
    el.addEventListener("wcs-raf:trigger-changed", (e) => details.push((e as CustomEvent).detail));
    el.trigger = true;
    expect(el.running).toBe(true);
    expect(el.trigger).toBe(false);
    expect(details).toEqual([false]);
  });

  it("trigger への false 書き込みは何もしない", () => {
    const el = createRaf({ manual: "" });
    const details: unknown[] = [];
    el.addEventListener("wcs-raf:trigger-changed", (e) => details.push((e as CustomEvent).detail));
    el.trigger = false;
    expect(el.running).toBe(false);
    expect(details).toEqual([]);
  });

  it("running 中の trigger でも trigger-changed は発火する（start は no-op）", () => {
    const el = createRaf();
    const details: unknown[] = [];
    el.addEventListener("wcs-raf:trigger-changed", (e) => details.push((e as CustomEvent).detail));
    el.trigger = true;
    expect(details).toEqual([false]);
    expect(scheduler.pending).toBe(1);
  });
});

describe("Raf: wcBindable 宣言面", () => {
  it("properties は Core の 5 面 + trigger", () => {
    const names = Raf.wcBindable.properties.map((p) => p.name);
    expect(names).toEqual(["tick", "elapsed", "dt", "running", "suspended", "trigger"]);
  });

  it("inputs は once/repeat/manual/trigger（interval/immediate は存在しない）", () => {
    const names = (Raf.wcBindable.inputs ?? []).map((i) => i.name);
    expect(names).toEqual(["once", "repeat", "manual", "trigger"]);
  });

  it("commands は start/stop/reset/pause/resume", () => {
    const names = (Raf.wcBindable.commands ?? []).map((c) => c.name);
    expect(names).toEqual(["start", "stop", "reset", "pause", "resume"]);
  });

  it("tick/elapsed/dt は単一イベントからの派生 getter を持つ（§4.2）", () => {
    const event = new CustomEvent("wcs-raf:tick", {
      detail: { count: 7, elapsed: 112, dt: 16, timestamp: 1234 },
    });
    const byName = new Map(RafCore.wcBindable.properties.map((p) => [p.name, p]));
    expect(byName.get("tick")?.event).toBe("wcs-raf:tick");
    expect(byName.get("tick")?.getter?.(event)).toBe(7);
    expect(byName.get("elapsed")?.getter?.(event)).toBe(112);
    expect(byName.get("dt")?.getter?.(event)).toBe(16);
  });
});
