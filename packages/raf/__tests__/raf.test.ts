import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Raf } from "../src/components/Raf";
import { RafCore } from "../src/core/RafCore";
import { registerComponents } from "../src/registerComponents";
import { FakeScheduler, installGlobalRafMock, setVisibility, resetVisibility } from "./helpers";

registerComponents();

/** 自動 start の判断はマイクロタスク（timing-and-firing-contract §23）: それを流す */
const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r));

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

  it("接続で自動 start し、display:none になる", async () => {
    const el = createRaf();
    await flush();
    expect(el.running).toBe(true);
    expect(el.style.display).toBe("none");
    expect(scheduler.pending).toBe(1);
  });

  it("manual 属性ありでは自動 start しない", async () => {
    const el = createRaf({ manual: "" });
    await flush();
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);
  });

  it("connectedCallbackPromise は resolve する（SSR 契約）", async () => {
    const el = createRaf({ manual: "" });
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    expect((el.constructor as typeof Raf).hasConnectedCallbackPromise).toBe(true);
  });

  it("切断で dispose され、保留フレームが発火しても tick は進まない", async () => {
    const el = createRaf();
    await flush();
    scheduler.pump(1000);
    expect(el.tick).toBe(1);
    el.remove();
    expect(el.running).toBe(false);
    scheduler.pump(2000);
    expect(el.tick).toBe(1);
  });

  it("remove → 再 appendChild で loop が再開し、suspended も追随し、初回 dt は 0 になる", async () => {
    const el = createRaf();
    await flush();
    scheduler.pump(1000);
    scheduler.pump(1016);
    expect(el.tick).toBe(2);
    expect(el.dt).toBe(16);
    el.remove();
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);

    document.body.appendChild(el);
    await flush();
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

// router は遷移で同じノードを入れ直し、state は新しい params からの入力をマイクロタスクで書く
// （timing-and-firing-contract §23、docs/seam-apps.md の shift-desk）
describe("Raf: 自動 start の判断はマイクロタスクで、そのときの入力で", () => {
  function runningLog(el: Raf): boolean[] {
    const log: boolean[] = [];
    el.addEventListener("wcs-raf:running-changed", (e) => log.push((e as CustomEvent).detail));
    return log;
  }

  it("入れ直しの間に repeat が書かれると、前の入力ではなく新しい repeat でループを始める", async () => {
    const el = createRaf();
    await flush();
    expect(el.running).toBe(true);
    const log = runningLog(el);

    // state のマイクロタスクは、router が中身を入れ直す前に積まれている
    queueMicrotask(() => { el.repeat = 1; });
    el.remove();
    document.body.appendChild(el);
    await flush();
    await flush();
    expect(log).toEqual([false, true]);
    expect(scheduler.pending).toBe(1);
    // repeat=1 のループ: 1 フレームで止まる（前の入力＝無制限では回り続けていた）
    scheduler.pump(1000);
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);
    expect(log).toEqual([false, true, false]);
  });

  it("入れ直しの間に manual が書かれると、前の入力で start しない", async () => {
    const el = createRaf();
    await flush();
    const log = runningLog(el);

    queueMicrotask(() => { el.manual = true; });
    el.remove();
    document.body.appendChild(el);
    await flush();
    await flush();
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);
    expect(log).toEqual([false]);
  });

  it("判断の前に外した要素は start しない", async () => {
    const el = document.createElement("wcs-raf") as Raf;
    const log = runningLog(el);
    document.body.appendChild(el);
    el.remove();
    await flush();
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);
    expect(log).toEqual([]);
  });

  it("同じタスクで接続の後に manual が書かれると、start しない", async () => {
    const el = createRaf();
    el.manual = true;
    await flush();
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);
  });

  it("同じタスクで接続の後に pause() を呼ぶと、予約の start をその場で行って一時停止し、resume() で再開できる", async () => {
    const el = document.createElement("wcs-raf") as Raf;
    const log = runningLog(el);
    document.body.appendChild(el);
    el.pause();
    await flush();
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);
    expect(log).toEqual([true, false]);
    el.resume();
    expect(el.running).toBe(true);
    expect(scheduler.pending).toBe(1);
  });

  it("pause() が予約を引き受けるときも、いまの manual に従う（start しない）", async () => {
    const el = document.createElement("wcs-raf") as Raf;
    const log = runningLog(el);
    document.body.appendChild(el);
    el.manual = true;
    el.pause();
    await flush();
    el.resume();
    expect(el.running).toBe(false);
    expect(log).toEqual([]);
  });

  it("外した後の pause() は予約を引き受けても start しない", async () => {
    const el = document.createElement("wcs-raf") as Raf;
    const log = runningLog(el);
    document.body.appendChild(el);
    el.remove();
    el.pause();
    await flush();
    expect(el.running).toBe(false);
    expect(log).toEqual([]);
  });

  it.each(["stop", "reset"] as const)(
    "同じタスクで接続の後に %s() を呼ぶと、自動 start の予約を取り消して何も始めない",
    async (command) => {
      const el = document.createElement("wcs-raf") as Raf;
      const log = runningLog(el);
      document.body.appendChild(el);
      el[command]();
      await flush();
      expect(el.running).toBe(false);
      expect(scheduler.pending).toBe(0);
      expect(log).toEqual([]);
    },
  );

  it("stop() で取り消した後に同じタスクで入れ直すと、その予約で 1 回だけ start する", async () => {
    const el = document.createElement("wcs-raf") as Raf;
    const log = runningLog(el);
    document.body.appendChild(el);
    el.stop();
    el.remove();
    document.body.appendChild(el);
    await flush();
    await flush();
    expect(log).toEqual([true]);
    expect(scheduler.pending).toBe(1);
  });

  it("同じタスクで接続の後に start() を呼んでも、予約の start は no-op で 1 回だけ", async () => {
    const el = document.createElement("wcs-raf") as Raf;
    const log = runningLog(el);
    document.body.appendChild(el);
    el.start();
    await flush();
    expect(log).toEqual([true]);
    expect(scheduler.pending).toBe(1);
  });

  it("同じタスクの外し・入れ直しはまとまり、start は 1 回", async () => {
    const el = document.createElement("wcs-raf") as Raf;
    const log = runningLog(el);
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);
    await flush();
    expect(log).toEqual([true]);
    expect(scheduler.pending).toBe(1);
  });
});

describe("Raf: フレームと委譲 getter", () => {
  it("tick/elapsed/dt を Core から委譲して返す", async () => {
    const el = createRaf();
    await flush();
    scheduler.pump(1000);
    scheduler.pump(1016);
    expect(el.tick).toBe(2);
    expect(el.dt).toBe(16);
    expect(el.elapsed).toBe(16);
  });

  it("wcs-raf:tick は要素からバブルする", async () => {
    createRaf();
    await flush();
    const details: unknown[] = [];
    document.body.addEventListener("wcs-raf:tick", (e) => details.push((e as CustomEvent).detail));
    scheduler.pump(1000);
    expect(details).toEqual([{ count: 1, elapsed: 0, dt: 0, timestamp: 1000 }]);
  });

  it("suspended は接続時の observe() 経由で visibility に追随する", async () => {
    const el = createRaf();
    await flush();
    expect(el.suspended).toBe(false);
    setVisibility("hidden");
    expect(el.suspended).toBe(true);
    setVisibility("visible");
    expect(el.suspended).toBe(false);
  });
});

describe("Raf: once / repeat 属性", () => {
  it("once は 1 フレームで自動停止する（repeat=1 の糖衣）", async () => {
    const el = createRaf({ once: "" });
    await flush();
    scheduler.pump(1000);
    expect(el.tick).toBe(1);
    expect(el.running).toBe(false);
    expect(scheduler.pending).toBe(0);
  });

  it("repeat=N は N フレームで停止する", async () => {
    const el = createRaf({ repeat: "3" });
    await flush();
    scheduler.pump(1000);
    scheduler.pump(1016);
    expect(el.running).toBe(true);
    scheduler.pump(1032);
    expect(el.running).toBe(false);
    expect(el.tick).toBe(3);
  });

  it("once と repeat が両方あるときは repeat が優先される", async () => {
    const el = createRaf({ once: "", repeat: "2" });
    await flush();
    scheduler.pump(1000);
    expect(el.running).toBe(true);
    scheduler.pump(1016);
    expect(el.running).toBe(false);
    expect(el.tick).toBe(2);
  });

  it("repeat 属性の不正値は 0（無制限）に正規化される", async () => {
    const el = createRaf({ manual: "" });
    await flush();
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

  it("once / repeat / manual のアクセサは属性とラウンドトリップする", async () => {
    const el = createRaf({ manual: "" });
    await flush();
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
  it("start/stop/reset/pause/resume が Core に委譲される", async () => {
    const el = createRaf({ manual: "" });
    await flush();
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

  it("trigger の false→true 書き込みで start し、trigger-changed(false) が発火する", async () => {
    const el = createRaf({ manual: "" });
    await flush();
    const details: unknown[] = [];
    el.addEventListener("wcs-raf:trigger-changed", (e) => details.push((e as CustomEvent).detail));
    el.trigger = true;
    expect(el.running).toBe(true);
    expect(el.trigger).toBe(false);
    expect(details).toEqual([false]);
  });

  it("trigger への false 書き込みは何もしない", async () => {
    const el = createRaf({ manual: "" });
    await flush();
    const details: unknown[] = [];
    el.addEventListener("wcs-raf:trigger-changed", (e) => details.push((e as CustomEvent).detail));
    el.trigger = false;
    expect(el.running).toBe(false);
    expect(details).toEqual([]);
  });

  it("running 中の trigger でも trigger-changed は発火する（start は no-op）", async () => {
    const el = createRaf();
    await flush();
    const details: unknown[] = [];
    el.addEventListener("wcs-raf:trigger-changed", (e) => details.push((e as CustomEvent).detail));
    el.trigger = true;
    expect(details).toEqual([false]);
    expect(scheduler.pending).toBe(1);
  });
});

describe("Raf: reduced-motion 属性", () => {
  it("属性値が正規化されて Core へ届く（未知値・属性削除は run）", () => {
    const el = document.createElement("wcs-raf") as Raf;
    el.setAttribute("reduced-motion", "pause");
    expect(el.reducedMotion).toBe("pause");
    el.setAttribute("reduced-motion", "bogus");
    expect(el.reducedMotion).toBe("run");
    el.setAttribute("reduced-motion", "pause");
    el.removeAttribute("reduced-motion");
    expect(el.reducedMotion).toBe("run");
  });

  it("プロパティ setter は属性へミラーし、正規化済みの値が読める", () => {
    const el = document.createElement("wcs-raf") as Raf;
    el.reducedMotion = "pause";
    expect(el.getAttribute("reduced-motion")).toBe("pause");
    expect(el.reducedMotion).toBe("pause");
  });
});

describe("Raf: null / undefined の書き込み（P1 / P2）", () => {
  it("undefined はマークアップに書かれた属性へ戻し、null は属性を外して既定へ戻す", () => {
    const host = document.createElement("div");
    host.innerHTML = '<wcs-raf once repeat="3" manual reduced-motion="pause"></wcs-raf>';
    const el = host.firstElementChild as Raf;
    el.once = false;
    el.repeat = 7;
    el.manual = false;
    el.reducedMotion = "run";
    expect(el.reducedMotion).toBe("run");
    el.once = undefined;
    el.repeat = undefined;
    el.manual = undefined;
    el.reducedMotion = undefined;
    expect(el.once).toBe(true);
    expect(el.repeat).toBe(3);
    expect(el.manual).toBe(true);
    expect(el.getAttribute("reduced-motion")).toBe("pause");
    expect(el.reducedMotion).toBe("pause");
    el.once = null;
    el.repeat = null;
    el.manual = null;
    el.reducedMotion = null;
    expect(el.once).toBe(false);
    expect(el.hasAttribute("repeat")).toBe(false);
    expect(el.repeat).toBe(0);
    expect(el.manual).toBe(false);
    expect(el.hasAttribute("reduced-motion")).toBe(false);
    expect(el.reducedMotion).toBe("run");
  });
});

describe("Raf: wcBindable 宣言面", () => {
  it("properties は Core の 5 面 + trigger", () => {
    const names = Raf.wcBindable.properties.map((p) => p.name);
    expect(names).toEqual(["tick", "elapsed", "dt", "running", "suspended", "trigger"]);
  });

  it("inputs は once/repeat/manual/reducedMotion/trigger（interval/immediate は存在しない）", () => {
    const names = (Raf.wcBindable.inputs ?? []).map((i) => i.name);
    expect(names).toEqual(["once", "repeat", "manual", "reducedMotion", "trigger"]);
    const reduced = (Raf.wcBindable.inputs ?? []).find((i) => i.name === "reducedMotion");
    expect(reduced?.attribute).toBe("reduced-motion");
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
