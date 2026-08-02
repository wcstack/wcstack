import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// Phase B PoC の受け入れ条件（docs/audio-impl-plan.md §B-3）を実ブラウザで検証する。
//
// 狙いは2つ。
//  1. ADR-14 G1「トポロジの正本は descriptor tree、DOM はオーサリング面」が
//     実際に成立すること。ここでは <wcs-*> タグを1つも使わず、plain object の
//     Patch だけから音を出す。
//  2. 「音が出た」を主観でなくサンプル値で示すこと。OfflineAudioContext は
//     ユーザージェスチャを要求せず、実時間より速く決定的にレンダリングするので
//     CI で回せる。Phase C のテスト戦略（モックで形状・実ブラウザで信号）の土台。
const SR = 48000;

test.describe("e2e/fixtures/audio-graph-poc", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/audio-graph-poc/index.html");
    await page.waitForFunction(() => (window as any).__pocReady === true);
  });

  test("B-3-1: DOM ゼロの Patch から可聴信号が出る", async ({ page }) => {
    const errors = collectErrors(page);
    const result = await page.evaluate(async (sr) => {
      const { AudioGraphCore, rms } = (window as any).PoC;
      const ctx = new OfflineAudioContext(1, sr * 0.5, sr);
      const core = new AudioGraphCore({ context: ctx });
      core.setPatch({
        nodes: [{
          kind: "osc", key: "o1", params: { frequency: 440 }, props: { type: "sine" },
          children: [{ kind: "gain", key: "g1", params: { gain: 0.5 } }],
        }],
        voices: [],
      });
      const buf = await ctx.startRendering();
      return { rms: rms(buf.getChannelData(0)), warnings: core.warnings };
    }, SR);

    // 無音は RMS ≈ 0。sine * 0.5 * master 0.8 の理論 RMS は約 0.28。
    expect(result.rms).toBeGreaterThan(0.05);
    expect(result.warnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("B-3-2: setParam は rebuild なしで周波数に反映される", async ({ page }) => {
    const errors = collectErrors(page);
    const result = await page.evaluate(async (sr) => {
      const { AudioGraphCore, zeroCrossings } = (window as any).PoC;
      const patch = {
        nodes: [{ kind: "osc", key: "o1", params: { frequency: 440 }, props: { type: "sine" } }],
        voices: [],
      };

      const render = async (mutate: (core: any) => void) => {
        const ctx = new OfflineAudioContext(1, sr * 0.5, sr);
        const core = new AudioGraphCore({ context: ctx });
        core.setPatch(patch);
        mutate(core);
        const buf = await ctx.startRendering();
        const d = buf.getChannelData(0);
        // 平滑化（setTargetAtTime tau=0.02）が収束した後半だけ数える。
        return { crossings: zeroCrossings(d, sr * 0.25, sr * 0.5), rebuilt: (core as any).__rebuilt };
      };

      const base = await render(() => {});
      const bumped = await render((core) => { core.setParam("o1", "frequency", 880); });

      // 同一構造・数値だけ違う patch を再投入しても rebuild しない（冪等）。
      const ctx = new OfflineAudioContext(1, 128, sr);
      const core = new AudioGraphCore({ context: ctx });
      core.setPatch(patch);
      const rebuiltOnValueOnly = core.setPatch({
        nodes: [{ kind: "osc", key: "o1", params: { frequency: 880 }, props: { type: "sine" } }],
        voices: [],
      });

      return { base: base.crossings, bumped: bumped.crossings, rebuiltOnValueOnly };
    }, SR);

    // 0.25 秒間のゼロ交差数 ≈ 2 * f * 0.25。440Hz→約220、880Hz→約440。
    expect(result.base).toBeGreaterThan(200);
    expect(result.base).toBeLessThan(240);
    expect(result.bumped).toBeGreaterThan(420);
    expect(result.bumped).toBeLessThan(460);
    expect(result.rebuiltOnValueOnly).toBe(false);
    expect(errors).toEqual([]);
  });

  test("B-3-3: voice でポリフォニーが成立し poly 上限でスティールする", async ({ page }) => {
    const errors = collectErrors(page);
    const result = await page.evaluate(async (sr) => {
      const { AudioGraphCore, rms, quantum } = (window as any).PoC;
      // 振幅は必ずリミッター閾値（-18 dBFS ≒ 0.126）より下に置く。上回ると
      // DynamicsCompressor が効いて「音が増えても RMS がほぼ増えない」ため、
      // 加算性を見る assert が成立しなくなる（実測で確認済み）。
      const patch = {
        nodes: [],
        voices: [{
          key: "v1", poly: 2,
          nodes: [{
            kind: "osc", key: "vo", note: true, props: { type: "sine" },
            children: [{
              kind: "env", key: "ve",
              props: { attack: 0.005, decay: 0.05, sustain: 0.9, release: 0.05 },
              children: [{ kind: "gain", key: "vg", params: { gain: 0.05 } }],
            }],
          }],
        }],
      };

      // 発音数のカウントは描画不要 — スティールは同期的に観測できる。
      const counting = new AudioGraphCore({ context: new OfflineAudioContext(1, 128, sr) });
      counting.setPatch(patch);
      counting.noteOn(60); counting.noteOn(64); counting.noteOn(67);
      const afterThree = counting.activeVoices;

      // 音量としてのポリフォニー: 単音区間と和音区間の RMS を比べる。
      const ctx = new OfflineAudioContext(1, sr * 1.5, sr);
      const core = new AudioGraphCore({ context: ctx });
      core.setPatch(patch);
      core.noteOn(60, 1);
      const at = quantum(0.6, sr);
      ctx.suspend(at).then(() => { core.noteOn(64, 1); ctx.resume(); });
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);

      return {
        afterThree,
        single: rms(d, sr * 0.2, sr * 0.5),
        chord: rms(d, sr * 0.9, sr * 1.2),
        warnings: core.warnings,
      };
    }, SR);

    // poly=2 に3音 → 最古が奪われて発音中は2のまま。
    expect(result.afterThree).toBe(2);
    expect(result.single).toBeGreaterThan(0.01);
    // 無相関な2音の RMS は理論上 √2 ≒ 1.41 倍。圧縮域を外れていれば届く。
    expect(result.chord).toBeGreaterThan(result.single * 1.3);
    expect(result.warnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("B-3-4: setPatch は構造が変わったときだけ rebuild する", async ({ page }) => {
    const result = await page.evaluate(async (sr) => {
      const { AudioGraphCore } = (window as any).PoC;
      const core = new AudioGraphCore({ context: new OfflineAudioContext(1, 128, sr) });
      const base = {
        nodes: [{ kind: "osc", key: "o1", params: { frequency: 440 },
                  children: [{ kind: "gain", key: "g1", params: { gain: 0.5 } }] }],
        voices: [],
      };
      const first = core.setPatch(base);
      const same = core.setPatch(JSON.parse(JSON.stringify(base)));
      const valueOnly = core.setPatch({
        nodes: [{ kind: "osc", key: "o1", params: { frequency: 220 },
                  children: [{ kind: "gain", key: "g1", params: { gain: 0.9 } }] }],
        voices: [],
      });
      const structural = core.setPatch({
        nodes: [{ kind: "osc", key: "o1", params: { frequency: 220 },
                  children: [{ kind: "biquad", key: "b1", params: { frequency: 800 } }] }],
        voices: [],
      });
      return { first, same, valueOnly, structural };
    }, SR);

    expect(result.first).toBe(true);
    expect(result.same).toBe(false);
    expect(result.valueOnly).toBe(false);
    expect(result.structural).toBe(true);
  });

  test("B-3-5: モック context と実 context のエッジ集合が同型", async ({ page }) => {
    const result = await page.evaluate(async (sr) => {
      const { AudioGraphCore, instrument, FakeAudioContext } = (window as any).PoC;
      // out= / param= / master タップ / voice を全部含む患部の広いパッチ。
      const patch = {
        nodes: [
          { kind: "gain", key: "bus", id: "bus", params: { gain: 0.8 },
            children: [{ kind: "delay", key: "fx", params: { time: 0.2, feedback: 0.3 } }] },
          { kind: "analyser", key: "scope", master: true },
        ],
        voices: [{
          key: "v1", poly: 4,
          nodes: [
            { kind: "osc", key: "o1", note: true, out: ["vcf"] },
            { kind: "noise", key: "n1", out: ["vcf"] },
            { kind: "biquad", key: "vcf", id: "vcf", params: { frequency: 1200 },
              children: [
                { kind: "lfo", key: "lfo1", param: "frequency", params: { rate: 4, depth: 200 } },
                { kind: "env", key: "amp", out: ["bus"] },
              ] },
          ],
        }],
      };

      const run = (ctx: any) => {
        const inst = instrument(ctx);
        const core = new AudioGraphCore({ context: inst.context });
        core.setPatch(patch);
        core.noteOn(60);
        return { snapshot: inst.snapshot(), warnings: core.warnings };
      };

      const fake = run(new FakeAudioContext({ sampleRate: sr }));
      const real = run(new OfflineAudioContext(1, 128, sr));
      return { fake, real };
    }, SR);

    expect(result.fake.warnings).toEqual([]);
    expect(result.real.warnings).toEqual([]);
    expect(result.fake.snapshot.length).toBeGreaterThan(10);
    expect(result.real.snapshot).toEqual(result.fake.snapshot);
  });

  test("B-3-6: 解放済みボイスは audio クロックの前進だけで回収される", async ({ page }) => {
    const result = await page.evaluate(async (sr) => {
      const { AudioGraphCore, quantum } = (window as any).PoC;
      const ctx = new OfflineAudioContext(1, sr * 2, sr);
      const core = new AudioGraphCore({ context: ctx });
      core.setPatch({
        nodes: [],
        voices: [{
          key: "v1", poly: 4,
          nodes: [{
            kind: "osc", key: "vo", note: true,
            children: [{ kind: "env", key: "ve", props: { release: 0.2 } }],
          }],
        }],
      });

      const trace: Record<string, number> = {};
      core.noteOn(60);
      trace.afterNoteOn = core.allocatedVoices;

      // release=0.2 → freeAt = noteOff + 0.2*3 + 0.3 = +0.9
      ctx.suspend(quantum(0.5, sr)).then(() => {
        core.noteOff(60);
        trace.afterNoteOff = core.allocatedVoices;
        ctx.resume();
      });
      ctx.suspend(quantum(1.0, sr)).then(() => {
        core.sweep();                       // まだ freeAt(1.4) 前 — 残る
        trace.beforeFreeAt = core.allocatedVoices;
        ctx.resume();
      });
      ctx.suspend(quantum(1.5, sr)).then(() => {
        core.sweep();                       // freeAt を越えた — 回収される
        trace.afterFreeAt = core.allocatedVoices;
        ctx.resume();
      });
      await ctx.startRendering();
      return trace;
    }, SR);

    expect(result.afterNoteOn).toBe(1);
    expect(result.afterNoteOff).toBe(1);
    expect(result.beforeFreeAt).toBe(1);
    // タイマーは1つも使っていない。currentTime が進んだことだけが回収の根拠。
    expect(result.afterFreeAt).toBe(0);
  });
});
