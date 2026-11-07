import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// @wcstack/audio の実ブラウザスモーク。
//
// unit test（packages/audio/__tests__）はモック context でグラフの**形**を固定する。
// こちらは OfflineAudioContext で実際にレンダリングし、**信号**が出ていることを
// サンプル値で確かめる。2階建てにしているのは、モックがどれだけ忠実でも
// 「通るのにブラウザで鳴らない」を検出できないため（docs/audio-impl-plan.md §C-3/§C-4）。
//
// OfflineAudioContext はユーザージェスチャを要求せず、実時間より速く決定的に
// レンダリングするので、この検証は CI でそのまま回せる。
declare global {
  interface Window {
    renderPatch(options: {
      html: string;
      seconds?: number;
      steps?: { at: number; run: (root: any, trace: any) => void }[];
      onReady?: (root: any) => void;
    }): Promise<{ data: Float32Array; trace: any; root: any }>;
    audioProbe: {
      rms(data: Float32Array, from?: number, to?: number): number;
      zeroCrossings(data: Float32Array, from?: number, to?: number): number;
      peak(data: Float32Array): number;
    };
    __audioReady: boolean;
  }
}

test.describe("e2e/fixtures/audio-offline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/e2e/fixtures/audio-offline/index.html");
    await page.waitForFunction(() => window.__audioReady === true);
  });

  test("マークアップだけのパッチが実際に音になる", async ({ page }) => {
    const errors = collectErrors(page);
    const result = await page.evaluate(async () => {
      const { data } = await window.renderPatch({
        html: `<wcs-audio volume="0.5">
                 <wcs-osc type="sine" frequency="440">
                   <wcs-gain gain="0.2"></wcs-gain>
                 </wcs-osc>
               </wcs-audio>`,
        seconds: 0.5,
      });
      return {
        rms: window.audioProbe.rms(data),
        // 0.25 秒間のゼロ交差数 ≈ 2 * f * 0.25
        crossings: window.audioProbe.zeroCrossings(data, 48000 * 0.25, 48000 * 0.5),
      };
    });

    expect(result.rms).toBeGreaterThan(0.01);
    expect(result.crossings).toBeGreaterThan(200);
    expect(result.crossings).toBeLessThan(240);
    expect(errors).toEqual([]);
  });

  test("属性の書き換えは rebuild なしで音程に反映される", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { data } = await window.renderPatch({
        html: `<wcs-audio volume="0.5">
                 <wcs-osc type="sine" frequency="440">
                   <wcs-gain gain="0.2"></wcs-gain>
                 </wcs-osc>
               </wcs-audio>`,
        seconds: 1,
        steps: [{
          at: 0.5,
          run: (root) => root.querySelector("wcs-osc").setAttribute("frequency", "880"),
        }],
      });
      const zc = window.audioProbe.zeroCrossings;
      return {
        before: zc(data, 48000 * 0.1, 48000 * 0.35),
        after: zc(data, 48000 * 0.7, 48000 * 0.95),
      };
    });

    // 0.25 秒あたり: 440Hz → 約 220、880Hz → 約 440
    expect(result.before).toBeGreaterThan(200);
    expect(result.before).toBeLessThan(240);
    expect(result.after).toBeGreaterThan(420);
    expect(result.after).toBeLessThan(460);
  });

  test("<wcs-voice> でポリフォニーが成立する", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { data } = await window.renderPatch({
        // 振幅はリミッター閾値（-18 dBFS ≒ 0.126）より下に置く。上回ると
        // DynamicsCompressor が効いて加算性が見えなくなる。
        html: `<wcs-audio volume="0.5">
                 <wcs-voice poly="4">
                   <wcs-osc type="sine" note>
                     <wcs-env attack="0.005" decay="0.05" sustain="0.9" release="0.05">
                       <wcs-gain gain="0.05"></wcs-gain>
                     </wcs-env>
                   </wcs-osc>
                 </wcs-voice>
               </wcs-audio>`,
        seconds: 1.5,
        onReady: (root) => root.noteOn(60, 1),
        steps: [{ at: 0.6, run: (root) => root.noteOn(64, 1) }],
      });
      const rms = window.audioProbe.rms;
      return {
        single: rms(data, 48000 * 0.2, 48000 * 0.5),
        chord: rms(data, 48000 * 0.9, 48000 * 1.2),
      };
    });

    expect(result.single).toBeGreaterThan(0.005);
    // 無相関な2音の RMS は理論上 √2 ≒ 1.41 倍
    expect(result.chord).toBeGreaterThan(result.single * 1.3);
  });

  test("解放したボイスは audio クロックの前進だけで回収される", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { trace } = await window.renderPatch({
        html: `<wcs-audio>
                 <wcs-voice poly="4">
                   <wcs-osc type="sine" note><wcs-env release="0.2"></wcs-env></wcs-osc>
                 </wcs-voice>
               </wcs-audio>`,
        seconds: 2,
        onReady: (root) => root.noteOn(60),
        steps: [
          { at: 0.5, run: (root, t) => { root.noteOff(60); t.afterOff = root.voices; } },
          { at: 1.0, run: (root, t) => { root.audioCore.sweep(); t.beforeFreeAt = root.audioCore.allocatedVoices; } },
          { at: 1.5, run: (root, t) => { root.audioCore.sweep(); t.afterFreeAt = root.audioCore.allocatedVoices; } },
        ],
      });
      return trace;
    });

    expect(result.afterOff).toBe(0);        // 発音中は 0（テールのみ）
    expect(result.beforeFreeAt).toBe(1);    // freeAt(1.4) 前なのでまだ残る
    // タイマーは一切使っていない。currentTime が進んだことだけが回収の根拠。
    expect(result.afterFreeAt).toBe(0);
  });

  // LFO がカットオフを「揺らしている」ことの証拠は平均音量ではなく、音量が
  // 時間とともに周期的に変わること。変調は上にも下にも振れるので、平均は
  // むしろ下がる（実測: 0.072 → 0.042）。見るべきは分散。
  test("LFO がフィルターを周期的に動かす", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const render = (extra: string) => window.renderPatch({
        html: `<wcs-audio volume="0.5">
                 <wcs-osc type="sawtooth" frequency="220">
                   <wcs-biquad type="lowpass" frequency="600" q="1">
                     ${extra}
                     <wcs-gain gain="0.2"></wcs-gain>
                   </wcs-biquad>
                 </wcs-osc>
               </wcs-audio>`,
        seconds: 0.5,
      });

      // 0.2〜0.5 秒を 10 窓に切って窓ごとの RMS を測り、その振れ幅を見る。
      const envelope = (data: Float32Array) => {
        const windows = [];
        for (let i = 0; i < 10; i++) {
          // 丸めないと浮動小数の誤差で末尾が配列長を1サンプル超え、RMS が NaN になる。
          const from = Math.round(48000 * (0.2 + i * 0.03));
          const to = Math.min(from + Math.round(48000 * 0.03), data.length);
          windows.push(window.audioProbe.rms(data, from, to));
        }
        const max = Math.max(...windows), min = Math.min(...windows);
        const mean = windows.reduce((a, b) => a + b, 0) / windows.length;
        return { spread: (max - min) / mean, mean };
      };

      const plain = envelope((await render("")).data);
      const modulated = envelope(
        (await render(`<wcs-lfo type="sine" rate="6" depth="1500" param="frequency"></wcs-lfo>`)).data,
      );
      return { plain, modulated };
    });

    // どちらも鳴っている
    expect(result.plain.mean).toBeGreaterThan(0.001);
    expect(result.modulated.mean).toBeGreaterThan(0.001);
    // 変調なしはほぼ一定、変調ありは目に見えて脈打つ
    expect(result.plain.spread).toBeLessThan(0.1);
    expect(result.modulated.spread).toBeGreaterThan(0.3);
  });

  test("<wcs-analyser> の master タップが信号を捉える", async ({ page }) => {
    const result = await page.evaluate(async () => {
      let frame: number[] = [];
      await window.renderPatch({
        html: `<wcs-audio volume="0.5">
                 <wcs-osc type="sine" frequency="440"><wcs-gain gain="0.3"></wcs-gain></wcs-osc>
                 <wcs-analyser id="scope" master></wcs-analyser>
               </wcs-audio>`,
        seconds: 0.5,
        steps: [{
          at: 0.3,
          run: (root) => {
            const analyser = root.querySelector("wcs-analyser");
            analyser.addEventListener("wcs-analyser:frame", (e: any) => { frame = [...e.detail]; });
            analyser.sample();
          },
        }],
      });
      // 無音なら全サンプルが 128（中央値）。振れていれば信号が届いている。
      const spread = Math.max(...frame) - Math.min(...frame);
      return { length: frame.length, spread };
    });

    expect(result.length).toBe(2048);
    expect(result.spread).toBeGreaterThan(10);
  });

  // 耳の保護（4.17）: リミッターが有効なら出力は -6 dBFS（振幅 0.501）を超えない。
  // 4.16 までのリミッターは threshold だけを設定した DynamicsCompressor で、天井ではなかった。
  // README の 8 声パッチ（Quick Start 2）の和音は既定の volume 0.8 で +4.9 dBFS
  // （1 音で +0.7 dBFS、limiter="off" で +12.3 dBFS）に達していた（Chromium, mono で実測）。
  const README_SYNTH = (attrs: string) => `<wcs-audio ${attrs}>
      <wcs-voice poly="8">
        <wcs-osc type="sawtooth" note detune="-7" out="vcf"></wcs-osc>
        <wcs-osc type="sawtooth" note detune="7" out="vcf"></wcs-osc>
        <wcs-osc type="square" note transpose="-12" out="vcf"></wcs-osc>
        <wcs-biquad id="vcf" type="lowpass" frequency="1400" q="4">
          <wcs-lfo type="sine" rate="4" param="frequency" depth="0"></wcs-lfo>
          <wcs-env attack="0.01" decay="0.25" sustain="0.55" release="0.35" out="bus"></wcs-env>
        </wcs-biquad>
      </wcs-voice>
      <wcs-gain id="bus" gain="0.8">
        <wcs-delay time="0.28" feedback="0.35" mix="0.2"></wcs-delay>
      </wcs-gain>
    </wcs-audio>`;
  const CHORD = [60, 62, 64, 65, 67, 69, 71, 72];

  test("README の 8 声パッチで 8 音の和音（velocity 1）を弾いても -6 dBFS を超えない", async ({ page }) => {
    const result = await page.evaluate(async ({ on, off, chord }) => {
      const render = async (html: string) => {
        const { data } = await window.renderPatch({
          html, seconds: 2,
          onReady: (root) => { for (const n of chord) root.noteOn(n, 1); },
        });
        return window.audioProbe.peak(data);
      };
      return { limited: await render(on), raw: await render(off) };
    }, { on: README_SYNTH(""), off: README_SYNTH('limiter="off"'), chord: CHORD });

    // 測っているのは熱い信号であること: リミッターを外すと 0 dBFS を大きく超える
    expect(result.raw).toBeGreaterThan(2);
    // 天井は厳密（最後の段はオーバーサンプルしないハードクリップ）
    expect(result.limited).toBeLessThanOrEqual(0.501);
    // 潰しすぎてもいない
    expect(result.limited).toBeGreaterThan(0.25);
  });

  test("volume は 1 にクランプされる: volume=\"80\" でも天井を超えず、volume=\"1\" と同じ音になる", async ({ page }) => {
    const result = await page.evaluate(async ({ hot, unity, chord }) => {
      const render = async (html: string) => {
        const { data, root } = await window.renderPatch({
          html, seconds: 2,
          onReady: (r) => { for (const n of chord) r.noteOn(n, 1); },
        });
        return { data: new Float32Array(data), volume: root.volume };
      };
      const a = await render(hot);
      const b = await render(unity);
      let diff = 0;
      for (let i = 0; i < a.data.length; i++) diff = Math.max(diff, Math.abs(a.data[i] - b.data[i]));
      return { peak: window.audioProbe.peak(a.data), volume: a.volume, diff };
    }, { hot: README_SYNTH('volume="80"'), unity: README_SYNTH('volume="1"'), chord: CHORD });

    expect(result.volume).toBe(1);
    expect(result.peak).toBeLessThanOrEqual(0.501);
    // 同じ描画（2 回のレンダリングの浮動小数の揺れだけ: 実測 1.4e-6）。クランプが無ければ 80 倍の入力で別物になる
    expect(result.diff).toBeLessThan(1e-4);
  });

  test("-18 dBFS より小さい音はリミッターを通っても大きさが変わらない（自動メイクアップを打ち消す）", async ({ page }) => {
    const result = await page.evaluate(async () => {
      // volume 0.5 × gain 0.1 = 振幅 0.05（-26 dBFS）
      const { data } = await window.renderPatch({
        html: `<wcs-audio volume="0.5">
                 <wcs-osc type="sine" frequency="440"><wcs-gain gain="0.1"></wcs-gain></wcs-osc>
               </wcs-audio>`,
        seconds: 0.5,
      });
      return window.audioProbe.peak(data.subarray(48000 * 0.2));
    });

    expect(result).toBeGreaterThan(0.049);
    expect(result).toBeLessThan(0.051);
  });

  test("無関係な DOM 変更では音が切れない（rebuild しない）", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { data } = await window.renderPatch({
        html: `<wcs-audio volume="0.5">
                 <wcs-voice poly="4">
                   <wcs-osc type="sine" note>
                     <wcs-env attack="0.005" sustain="0.9" release="0.05">
                       <wcs-gain gain="0.05"></wcs-gain>
                     </wcs-env>
                   </wcs-osc>
                 </wcs-voice>
               </wcs-audio>`,
        seconds: 1,
        onReady: (root) => root.noteOn(60, 1),
        steps: [{
          at: 0.5,
          run: (root) => {
            // 原型ではこれで発音中の音が切れていた。
            const div = document.createElement("div");
            div.innerHTML = "<label><input type='range'></label>";
            root.appendChild(div);
          },
        }],
      });
      const rms = window.audioProbe.rms;
      return {
        before: rms(data, 48000 * 0.2, 48000 * 0.45),
        after: rms(data, 48000 * 0.7, 48000 * 0.95),
      };
    });

    expect(result.before).toBeGreaterThan(0.005);
    // 切れていれば after はほぼ 0 になる
    expect(result.after).toBeGreaterThan(result.before * 0.8);
  });
});
