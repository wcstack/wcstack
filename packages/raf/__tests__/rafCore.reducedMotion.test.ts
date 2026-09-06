import { describe, it, expect, afterEach } from "vitest";
import { RafCore } from "../src/core/RafCore";
import { WcsRafTickDetail } from "../src/types";
import {
  FakeScheduler,
  FakeMediaQuery,
  installGlobalRafMock,
  removeGlobalRaf,
  setVisibility,
  resetVisibility,
} from "./helpers";

// prefers-reduced-motion ゲート（docs/a11y-design.md §6・D6）。
// suspended の第二原因: suspended = running && (hidden || reducedGate)。
// visibility と違いブラウザはフレーム配送を止めてくれないので、ゲート ON は
// Core がアーム済みフレームを取り消し、OFF は dt=0 境界で 1 本だけ再アームする。

function createReducedCore(): { core: RafCore; scheduler: FakeScheduler; media: FakeMediaQuery } {
  const scheduler = new FakeScheduler();
  const media = new FakeMediaQuery();
  const core = new RafCore(undefined, scheduler, media.matchMedia);
  return { core, scheduler, media };
}

function collectTicks(core: RafCore): WcsRafTickDetail[] {
  const ticks: WcsRafTickDetail[] = [];
  core.addEventListener("wcs-raf:tick", (e) => ticks.push((e as CustomEvent).detail));
  return ticks;
}

afterEach(() => {
  resetVisibility();
});

describe("RafCore: reduced-motion ゲートの購読", () => {
  it("observe() が prefers-reduced-motion を購読し、dispose() が解除する", async () => {
    const { core, media } = createReducedCore();
    await core.observe();
    expect(media.queries).toEqual(["(prefers-reduced-motion: reduce)"]);
    expect(media.listenerCount).toBe(1);
    // observe() は冪等（購読は 1 本のまま）
    await core.observe();
    expect(media.listenerCount).toBe(1);
    core.dispose();
    expect(media.listenerCount).toBe(0);
  });

  it("既定ポリシー \"run\" では preference がマッチしてもゲートは効かない", async () => {
    const { core, scheduler, media } = createReducedCore();
    media.matches = true;
    await core.observe();
    core.start();
    expect(core.suspended).toBe(false);
    expect(scheduler.pending).toBe(1);
    scheduler.pump(100);
    expect(core.tick).toBe(1);
    core.dispose();
  });

  it("matchMedia が throw する UA でも observe() は成功し、ゲートは決して効かない（never-throw）", async () => {
    const scheduler = new FakeScheduler();
    const core = new RafCore(undefined, scheduler, () => {
      throw new Error("boom");
    });
    await expect(core.observe()).resolves.toBeUndefined();
    core.reducedMotion = "pause";
    core.start();
    expect(scheduler.pending).toBe(1);
    core.dispose();
  });

  it("matchMedia の無い環境では注入なし observe() でもゲートは決して効かない", async () => {
    const g = globalThis as Record<string, unknown>;
    const snapshot = g.matchMedia;
    delete g.matchMedia;
    try {
      const scheduler = new FakeScheduler();
      const core = new RafCore(undefined, scheduler);
      core.reducedMotion = "pause";
      await core.observe();
      core.start();
      expect(scheduler.pending).toBe(1);
      core.dispose();
    } finally {
      if (snapshot === undefined) {
        delete g.matchMedia;
      } else {
        g.matchMedia = snapshot;
      }
    }
  });
});

describe("RafCore: reduced-motion ゲートの遷移", () => {
  it("実行中に reduce ON: アーム済みフレームを取り消し、running は維持したまま suspended=true", async () => {
    const { core, scheduler, media } = createReducedCore();
    core.reducedMotion = "pause";
    await core.observe();
    core.start();
    expect(scheduler.pending).toBe(1);

    media.setMatches(true);
    expect(core.running).toBe(true);
    expect(core.suspended).toBe(true);
    expect(scheduler.pending).toBe(0);
    core.dispose();
  });

  it("reduce OFF: dt=0 境界で 1 本だけ再アームし、停止期間は elapsed に加算されない", async () => {
    const { core, scheduler, media } = createReducedCore();
    core.reducedMotion = "pause";
    await core.observe();
    const ticks = collectTicks(core);
    core.start();
    scheduler.pump(100); // dt 0
    scheduler.pump(116); // dt 16

    media.setMatches(true);
    expect(scheduler.pending).toBe(0);

    media.setMatches(false);
    expect(core.suspended).toBe(false);
    expect(scheduler.pending).toBe(1);
    scheduler.pump(300); // 停止を跨ぐ値（184）は届かない
    expect(ticks.map((t) => t.dt)).toEqual([0, 16, 0]);
    expect(core.elapsed).toBe(16);
    core.dispose();
  });

  it("reduce 中の start(): running=true / suspended=true のまま非アームで、解除が再アームする（恒久ウェッジ防止）", async () => {
    const { core, scheduler, media } = createReducedCore();
    core.reducedMotion = "pause";
    media.matches = true;
    await core.observe();

    core.start();
    expect(core.running).toBe(true);
    expect(core.suspended).toBe(true);
    expect(scheduler.pending).toBe(0);

    media.setMatches(false);
    expect(scheduler.pending).toBe(1);
    scheduler.pump(500);
    expect(core.tick).toBe(1);
    expect(core.dt).toBe(0);
    core.dispose();
  });

  it("reduce 中の resume(): 非アームのまま suspended=true を報告する", async () => {
    const { core, scheduler, media } = createReducedCore();
    core.reducedMotion = "pause";
    await core.observe();
    core.start();
    scheduler.pump(100);
    core.pause();
    expect(core.running).toBe(false);

    media.setMatches(true);
    core.resume();
    expect(core.running).toBe(true);
    expect(core.suspended).toBe(true);
    expect(scheduler.pending).toBe(0);

    media.setMatches(false);
    expect(scheduler.pending).toBe(1);
    core.dispose();
  });

  it("tick リスナー内でポリシーが pause になった場合、フレーム尾部で再アームしない", async () => {
    const { core, scheduler, media } = createReducedCore();
    media.matches = true; // preference は最初からマッチ（ポリシーが run なので素通し）
    await core.observe();
    core.start();
    core.addEventListener(
      "wcs-raf:tick",
      () => {
        core.reducedMotion = "pause";
      },
      { once: true },
    );

    scheduler.pump(100);
    expect(core.tick).toBe(1);
    expect(scheduler.pending).toBe(0);
    expect(core.suspended).toBe(true);
    core.dispose();
  });

  it("ポリシーを run に戻すことはゲート解除と同じ（再アーム）", async () => {
    const { core, scheduler, media } = createReducedCore();
    core.reducedMotion = "pause";
    media.matches = true;
    await core.observe();
    core.start();
    expect(scheduler.pending).toBe(0);

    core.reducedMotion = "run";
    expect(core.suspended).toBe(false);
    expect(scheduler.pending).toBe(1);
    core.dispose();
  });

  it("ポリシーの same-value 書き込みは何もしない", async () => {
    const { core, scheduler, media } = createReducedCore();
    core.reducedMotion = "pause";
    media.matches = true;
    await core.observe();
    core.start();
    expect(scheduler.pending).toBe(0);
    // 同値の再代入はゲート再評価すら走らない（再アームされないことで観測）
    core.reducedMotion = "pause";
    expect(scheduler.pending).toBe(0);
    expect(core.suspended).toBe(true);
    core.dispose();
  });

  it("ゲート解除の瞬間に rAF が環境から消えていれば再アームは silent no-op（§3.7）", async () => {
    const scheduler = new FakeScheduler();
    const uninstall = installGlobalRafMock(scheduler);
    const media = new FakeMediaQuery();
    // scheduler 注入なし: グローバル rAF を呼び出し時解決する経路
    const core = new RafCore(undefined, undefined, media.matchMedia);
    core.reducedMotion = "pause";
    await core.observe();
    core.start();
    expect(scheduler.pending).toBe(1);

    media.setMatches(true);
    expect(scheduler.pending).toBe(0);

    const restoreRaf = removeGlobalRaf(); // ゲート解除の前に rAF が消える
    media.setMatches(false);
    expect(core.suspended).toBe(false); // suspended の答えは正直に更新される
    expect(scheduler.pending).toBe(0);  // ただし再アームは起きない（never-throw）
    core.dispose();
    restoreRaf();
    uninstall();
  });

  it("停止中のゲート変化は何もしない（次の start() が非アーム判定を行う）", async () => {
    const { core, scheduler, media } = createReducedCore();
    core.reducedMotion = "pause";
    await core.observe();
    media.setMatches(true);
    expect(core.suspended).toBe(false); // running が false なら suspended も false
    expect(scheduler.pending).toBe(0);
    media.setMatches(false);
    expect(scheduler.pending).toBe(0);
    core.dispose();
  });
});

describe("RafCore: hidden と reduce の順序マトリクス（両原因が消えたときだけ 1 本再アーム）", () => {
  it("reduce ON → hidden → reduce OFF → visible: どの時点でもループは高々 1 本", async () => {
    const { core, scheduler, media } = createReducedCore();
    core.reducedMotion = "pause";
    await core.observe();
    core.start();
    scheduler.pump(100);
    expect(scheduler.pending).toBe(1);

    media.setMatches(true);       // ゲート ON: 取り消し
    expect(scheduler.pending).toBe(0);
    setVisibility("hidden");      // 第二原因が重なる
    expect(core.suspended).toBe(true);
    expect(scheduler.pending).toBe(0);

    media.setMatches(false);      // ゲート解除（hidden のまま）: アームは 1 本
    expect(scheduler.pending).toBe(1);
    expect(core.suspended).toBe(true); // hidden がまだ残る

    setVisibility("visible");     // 両原因が消えた
    expect(core.suspended).toBe(false);
    expect(scheduler.pending).toBe(1); // 二重アームしない

    scheduler.pump(500);
    expect(core.dt).toBe(0); // 中断境界（G3）
    core.dispose();
  });

  it("hidden → reduce ON → visible → reduce OFF: 解除の瞬間だけ再アームする", async () => {
    const { core, scheduler, media } = createReducedCore();
    core.reducedMotion = "pause";
    await core.observe();
    core.start();
    scheduler.pump(100);

    setVisibility("hidden");      // visibility はアームを奪わない（配送はブラウザが止める）
    expect(scheduler.pending).toBe(1);
    media.setMatches(true);       // ゲート ON: ここで取り消し
    expect(scheduler.pending).toBe(0);

    setVisibility("visible");     // ゲートが残るのでアームしない
    expect(scheduler.pending).toBe(0);
    expect(core.suspended).toBe(true);

    media.setMatches(false);      // 最後の原因が消えた: 1 本だけ再アーム
    expect(scheduler.pending).toBe(1);
    expect(core.suspended).toBe(false);
    core.dispose();
  });
});
