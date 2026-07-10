import { describe, it, expect, vi, afterEach } from "vitest";
import { RafCore } from "../src/core/RafCore";
import { WcsRafTickDetail } from "../src/types";
import { FakeScheduler, removeGlobalRaf, installGlobalRafMock, setVisibility, resetVisibility } from "./helpers";

function createCore(options: { ignoreCancel?: boolean } = {}): { core: RafCore; scheduler: FakeScheduler } {
  const scheduler = new FakeScheduler(options);
  const core = new RafCore(undefined, scheduler);
  return { core, scheduler };
}

function collectTicks(core: RafCore): WcsRafTickDetail[] {
  const ticks: WcsRafTickDetail[] = [];
  core.addEventListener("wcs-raf:tick", (e) => ticks.push((e as CustomEvent).detail));
  return ticks;
}

function collectBooleans(core: RafCore, eventName: string): boolean[] {
  const values: boolean[] = [];
  core.addEventListener(eventName, (e) => values.push((e as CustomEvent).detail));
  return values;
}

afterEach(() => {
  resetVisibility();
});

describe("RafCore: 初期状態", () => {
  it("tick/elapsed/dt は 0、running/suspended は false", () => {
    const { core } = createCore();
    expect(core.tick).toBe(0);
    expect(core.elapsed).toBe(0);
    expect(core.dt).toBe(0);
    expect(core.running).toBe(false);
    expect(core.suspended).toBe(false);
  });

  it("ready / observe() は即 resolve する（SSR §3.8）", async () => {
    const { core } = createCore();
    await expect(core.ready).resolves.toBeUndefined();
    await expect(core.observe()).resolves.toBeUndefined();
    core.dispose();
  });

  it("target 省略時は自身に dispatch する", () => {
    const scheduler = new FakeScheduler();
    const core = new RafCore(undefined, scheduler);
    const ticks = collectTicks(core);
    core.start();
    scheduler.pump(100);
    expect(ticks.length).toBe(1);
  });

  it("target 指定時はその EventTarget に dispatch する", () => {
    const scheduler = new FakeScheduler();
    const target = new EventTarget();
    const core = new RafCore(target, scheduler);
    let fired = 0;
    target.addEventListener("wcs-raf:tick", () => fired++);
    core.start();
    scheduler.pump(100);
    expect(fired).toBe(1);
  });
});

describe("RafCore: tick と dt の契約（G3）", () => {
  it("初回フレームの dt は 0（timestamp がそのまま跨ぎ値にならない）", () => {
    const { core, scheduler } = createCore();
    const ticks = collectTicks(core);
    core.start();
    scheduler.pump(5000);
    expect(ticks[0]).toEqual({ count: 1, elapsed: 0, dt: 0, timestamp: 5000 });
    expect(core.dt).toBe(0);
  });

  it("連続フレームの dt は timestamp の差分、elapsed は Σdt", () => {
    const { core, scheduler } = createCore();
    const ticks = collectTicks(core);
    core.start();
    scheduler.pump(1000);
    scheduler.pump(1016);
    scheduler.pump(1049);
    expect(ticks.map((t) => t.dt)).toEqual([0, 16, 33]);
    expect(core.elapsed).toBe(49);
    expect(core.tick).toBe(3);
    expect(core.dt).toBe(33);
  });

  it("stop() → start() を跨ぐ初回 dt は 0（値は保持される）", () => {
    const { core, scheduler } = createCore();
    const ticks = collectTicks(core);
    core.start();
    scheduler.pump(1000);
    scheduler.pump(1016);
    core.stop();
    expect(core.tick).toBe(2);
    expect(core.elapsed).toBe(16);
    core.start();
    scheduler.pump(9000);
    expect(ticks[2]).toEqual({ count: 3, elapsed: 16, dt: 0, timestamp: 9000 });
  });

  it("pause() → resume() を跨ぐ初回 dt は 0、elapsed はポーズ期間を含まない", () => {
    const { core, scheduler } = createCore();
    core.start();
    scheduler.pump(1000);
    scheduler.pump(1016);
    core.pause();
    core.resume();
    scheduler.pump(60000);
    expect(core.dt).toBe(0);
    expect(core.elapsed).toBe(16);
    scheduler.pump(60016);
    expect(core.dt).toBe(16);
    expect(core.elapsed).toBe(32);
  });

  it("フレームは毎回発火する（同値ガードなし・reading 型）", () => {
    const { core, scheduler } = createCore();
    const ticks = collectTicks(core);
    core.start();
    scheduler.pump(1000);
    scheduler.pump(1016);
    scheduler.pump(1032);
    expect(ticks.length).toBe(3);
  });
});

describe("RafCore: start / stop / reset", () => {
  it("start で running true + running-changed 発火、フレームを予約する", () => {
    const { core, scheduler } = createCore();
    const runnings = collectBooleans(core, "wcs-raf:running-changed");
    core.start();
    expect(core.running).toBe(true);
    expect(runnings).toEqual([true]);
    expect(scheduler.pending).toBe(1);
  });

  it("running 中の再 start は no-op（二重ループしない）", () => {
    const { core, scheduler } = createCore();
    core.start();
    core.start();
    expect(scheduler.pending).toBe(1);
    scheduler.pump(1000);
    expect(core.tick).toBe(1);
  });

  it("フレームは毎回再予約される（恒常ループ）", () => {
    const { core, scheduler } = createCore();
    core.start();
    scheduler.pump(1000);
    expect(scheduler.pending).toBe(1);
    scheduler.pump(1016);
    expect(scheduler.pending).toBe(1);
  });

  it("stop で予約を取り消し、tick/elapsed は保持する", () => {
    const { core, scheduler } = createCore();
    const runnings = collectBooleans(core, "wcs-raf:running-changed");
    core.start();
    scheduler.pump(1000);
    scheduler.pump(1016);
    core.stop();
    expect(core.running).toBe(false);
    expect(runnings).toEqual([true, false]);
    expect(scheduler.pending).toBe(0);
    expect(core.tick).toBe(2);
    expect(core.elapsed).toBe(16);
  });

  it("停止中の stop は running-changed を出さない（同値ガード）", () => {
    const { core } = createCore();
    const runnings = collectBooleans(core, "wcs-raf:running-changed");
    core.stop();
    expect(runnings).toEqual([]);
  });

  it("reset は tick/elapsed/dt を 0 に戻し、timestamp 0 の通知 tick を出す", () => {
    const { core, scheduler } = createCore();
    const ticks = collectTicks(core);
    core.start();
    scheduler.pump(1000);
    scheduler.pump(1016);
    core.reset();
    expect(core.tick).toBe(0);
    expect(core.elapsed).toBe(0);
    expect(core.dt).toBe(0);
    expect(core.running).toBe(false);
    expect(ticks[ticks.length - 1]).toEqual({ count: 0, elapsed: 0, dt: 0, timestamp: 0 });
  });

  it("tick リスナー内で stop() すると再予約されない", () => {
    const { core, scheduler } = createCore();
    core.addEventListener("wcs-raf:tick", () => core.stop());
    core.start();
    scheduler.pump(1000);
    expect(core.running).toBe(false);
    expect(scheduler.pending).toBe(0);
  });

  it("tick リスナー内の同期 stop()→start() でフレームループが二重化しない", () => {
    const { core, scheduler } = createCore();
    core.addEventListener("wcs-raf:tick", () => {
      if (core.tick === 1) {
        core.stop();
        core.start();
      }
    });
    core.start();
    scheduler.pump(1000);
    // リスナーの start() が予約した 1 本だけ（外側の _frame は再予約しない）
    expect(scheduler.pending).toBe(1);
    scheduler.pump(1016);
    expect(core.tick).toBe(2);
    // 新しい run の意味論も維持: リスタート後の初回フレームは dt 0（G3）
    expect(core.dt).toBe(0);
    scheduler.pump(1032);
    expect(core.tick).toBe(3);
    expect(scheduler.pending).toBe(1);
    core.stop();
  });
});

describe("RafCore: repeat（有限フレーム）", () => {
  it("repeat=N は N フレームで自動停止する", () => {
    const { core, scheduler } = createCore();
    core.start({ repeat: 2 });
    scheduler.pump(1000);
    expect(core.running).toBe(true);
    scheduler.pump(1016);
    expect(core.running).toBe(false);
    expect(core.tick).toBe(2);
    expect(scheduler.pending).toBe(0);
  });

  it("完走後の再 start は再び N フレーム走る（per-run 基準）", () => {
    const { core, scheduler } = createCore();
    core.start({ repeat: 2 });
    scheduler.pump(1000);
    scheduler.pump(1016);
    core.start({ repeat: 2 });
    scheduler.pump(2000);
    expect(core.running).toBe(true);
    scheduler.pump(2016);
    expect(core.running).toBe(false);
    expect(core.tick).toBe(4);
  });

  it("repeat 省略の start は前回の有限指定を引き継がない", () => {
    const { core, scheduler } = createCore();
    core.start({ repeat: 1 });
    scheduler.pump(1000);
    expect(core.running).toBe(false);
    core.start();
    scheduler.pump(2000);
    expect(core.running).toBe(true);
    core.stop();
  });

  it("repeat に不正値（0/負/非数）を渡すと無制限になる", () => {
    const { core, scheduler } = createCore();
    core.start({ repeat: -3 });
    scheduler.pump(1000);
    scheduler.pump(1016);
    expect(core.running).toBe(true);
    core.stop();
    core.start({ repeat: Number.NaN });
    scheduler.pump(2000);
    expect(core.running).toBe(true);
  });
});

describe("RafCore: pause / resume", () => {
  it("pause で running false（予約取消）、resume で再開する", () => {
    const { core, scheduler } = createCore();
    const runnings = collectBooleans(core, "wcs-raf:running-changed");
    core.start();
    scheduler.pump(1000);
    core.pause();
    expect(core.running).toBe(false);
    expect(scheduler.pending).toBe(0);
    core.resume();
    expect(core.running).toBe(true);
    expect(runnings).toEqual([true, false, true]);
  });

  it("pause は running 中のみ（停止中は no-op）、resume は paused のみ", () => {
    const { core, scheduler } = createCore();
    core.pause();
    expect(core.running).toBe(false);
    core.resume();
    expect(core.running).toBe(false);
    expect(scheduler.pending).toBe(0);
  });

  it("二重 pause は no-op", () => {
    const { core, scheduler } = createCore();
    const runnings = collectBooleans(core, "wcs-raf:running-changed");
    core.start();
    core.pause();
    core.pause();
    expect(runnings).toEqual([true, false]);
    expect(scheduler.pending).toBe(0);
  });

  it("pause 中の repeat 残数は resume 後も引き継がれる", () => {
    const { core, scheduler } = createCore();
    core.start({ repeat: 2 });
    scheduler.pump(1000);
    core.pause();
    core.resume();
    scheduler.pump(2000);
    expect(core.running).toBe(false);
    expect(core.tick).toBe(2);
  });

  it("pause 後の start はポーズをクリアして新しい run を始める（resume は no-op になる）", () => {
    const { core, scheduler } = createCore();
    core.start();
    scheduler.pump(1000);
    core.pause();
    core.start();
    expect(core.running).toBe(true);
    core.resume();
    expect(scheduler.pending).toBe(1);
    scheduler.pump(2000);
    expect(core.dt).toBe(0);
  });

  it("tick リスナー内の同期 pause()→resume() でもフレームループが二重化しない", () => {
    const { core, scheduler } = createCore();
    core.addEventListener("wcs-raf:tick", () => {
      if (core.tick === 1) {
        core.pause();
        core.resume();
      }
    });
    core.start();
    scheduler.pump(1000);
    expect(scheduler.pending).toBe(1);
    scheduler.pump(1016);
    scheduler.pump(1032);
    expect(core.tick).toBe(3);
    expect(scheduler.pending).toBe(1);
    core.stop();
  });
});

describe("RafCore: suspended（G2 二相）", () => {
  it("observe() 前は hidden でも suspended にならない", () => {
    const { core } = createCore();
    core.start();
    setVisibility("hidden");
    expect(core.suspended).toBe(false);
    core.dispose();
  });

  it("running 中に hidden で suspended true、visible で false（イベント発火）", () => {
    const { core } = createCore();
    const suspendeds = collectBooleans(core, "wcs-raf:suspended-changed");
    core.observe();
    core.start();
    setVisibility("hidden");
    expect(core.suspended).toBe(true);
    setVisibility("visible");
    expect(core.suspended).toBe(false);
    expect(suspendeds).toEqual([true, false]);
    core.dispose();
  });

  it("suspended-changed は同値ガード（hidden の重複通知で 1 回だけ）", () => {
    const { core } = createCore();
    const suspendeds = collectBooleans(core, "wcs-raf:suspended-changed");
    core.observe();
    core.start();
    setVisibility("hidden");
    setVisibility("hidden");
    expect(suspendeds).toEqual([true]);
    core.dispose();
  });

  it("停止中は hidden でも suspended false / hidden 中の start は即 suspended true", () => {
    const { core } = createCore();
    core.observe();
    setVisibility("hidden");
    expect(core.suspended).toBe(false);
    core.start();
    expect(core.suspended).toBe(true);
    core.dispose();
  });

  it("suspended 中の stop / pause は suspended を解除する（意図が消える）", () => {
    const { core } = createCore();
    core.observe();
    core.start();
    setVisibility("hidden");
    expect(core.suspended).toBe(true);
    core.stop();
    expect(core.suspended).toBe(false);
    core.start();
    expect(core.suspended).toBe(true);
    core.pause();
    expect(core.suspended).toBe(false);
    core.dispose();
  });

  it("visibility 復帰後の最初のフレームは dt 0（中断を跨がない）", () => {
    const { core, scheduler } = createCore();
    core.observe();
    core.start();
    scheduler.pump(1000);
    scheduler.pump(1016);
    setVisibility("hidden");
    setVisibility("visible");
    scheduler.pump(30000);
    expect(core.dt).toBe(0);
    expect(core.elapsed).toBe(16);
    core.dispose();
  });

  it("observe() は冪等（多重購読しない）", () => {
    const { core } = createCore();
    const spy = vi.spyOn(document, "addEventListener");
    core.observe();
    core.observe();
    const calls = spy.mock.calls.filter(([type]) => type === "visibilitychange");
    expect(calls.length).toBe(1);
    spy.mockRestore();
    core.dispose();
  });
});

describe("RafCore: dispose / _gen 世代ガード", () => {
  it("dispose は停止し visibility 購読を解除する", () => {
    const { core } = createCore();
    const suspendeds = collectBooleans(core, "wcs-raf:suspended-changed");
    core.observe();
    core.start();
    core.dispose();
    expect(core.running).toBe(false);
    setVisibility("hidden");
    expect(core.suspended).toBe(false);
    expect(suspendeds).toEqual([]);
  });

  it("observe() していない dispose も安全（二重 dispose も可）", () => {
    const { core } = createCore();
    expect(() => {
      core.dispose();
      core.dispose();
    }).not.toThrow();
  });

  it("dispose 後に届いた stale フレームは状態変異も dispatch もしない（§3.4）", () => {
    const { core, scheduler } = createCore({ ignoreCancel: true });
    const ticks = collectTicks(core);
    core.start();
    core.dispose();
    scheduler.pump(1000);
    expect(core.tick).toBe(0);
    expect(ticks).toEqual([]);
  });

  it("stop→start の乗り替えでは旧予約が cancel され、フレームは二重にならない", () => {
    // JS は単一スレッドなので、フレーム発火前の同期的な stop() の cancel は
    // 常に成功する（「dequeue 済みで cancel 不能」は dispose 経路のみの想定）。
    const { core, scheduler } = createCore();
    core.start();
    core.stop();
    core.start();
    expect(scheduler.pending).toBe(1);
    scheduler.pump(1000);
    expect(core.tick).toBe(1);
    core.stop();
  });
});

describe("RafCore: rAF 不在環境（never-throw・§3.7 呼び出し時解決）", () => {
  it("rAF 不在では start は silent no-op（running は false のまま）", () => {
    const restore = removeGlobalRaf();
    try {
      const core = new RafCore();
      expect(() => core.start()).not.toThrow();
      expect(core.running).toBe(false);
    } finally {
      restore();
    }
  });

  it("pause 後に rAF が消えた場合の resume も silent no-op（paused は維持）", () => {
    const scheduler = new FakeScheduler();
    const uninstall = installGlobalRafMock(scheduler);
    try {
      const core = new RafCore();
      core.start();
      scheduler.pump(1000);
      core.pause();
      const restore = removeGlobalRaf();
      try {
        expect(() => core.resume()).not.toThrow();
        expect(core.running).toBe(false);
      } finally {
        restore();
      }
      // rAF が戻れば resume できる（paused が維持されている証明）
      core.resume();
      expect(core.running).toBe(true);
      core.dispose();
    } finally {
      uninstall();
    }
  });

  it("running 中に rAF が消えても stop は throw しない（cancel の呼び出し時解決）", () => {
    const scheduler = new FakeScheduler();
    const uninstall = installGlobalRafMock(scheduler);
    try {
      const core = new RafCore();
      core.start();
      const restore = removeGlobalRaf();
      try {
        expect(() => core.stop()).not.toThrow();
        expect(core.running).toBe(false);
      } finally {
        restore();
      }
    } finally {
      uninstall();
    }
  });

  it("フレーム処理中に rAF が消えた場合、再予約は静かにスキップされる", () => {
    const scheduler = new FakeScheduler();
    const uninstall = installGlobalRafMock(scheduler);
    try {
      const core = new RafCore();
      core.start();
      const restore = removeGlobalRaf();
      try {
        expect(() => scheduler.pump(1000)).not.toThrow();
        expect(core.tick).toBe(1);
        expect(scheduler.pending).toBe(0);
      } finally {
        restore();
      }
      core.dispose();
    } finally {
      uninstall();
    }
  });
});
