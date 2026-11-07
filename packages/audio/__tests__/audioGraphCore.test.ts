import { describe, it, expect, beforeEach } from "vitest";
import { AudioGraphCore, clampVolume } from "../src/core/AudioGraphCore";
import {
  LIMITER_CEILING, LIMITER_RATIO, LIMITER_THRESHOLD, MAKEUP_COMPENSATION, hardClipCurve, softClipCurve,
} from "../src/core/limiter";
import { structureKey } from "../src/patch/structureKey";
import { Patch } from "../src/types";
import { FakeAudioContext, FakeAudioParam, resetNodeIds } from "./FakeAudioContext";
import { FULL, GATELESS, SIMPLE, VOICE } from "./patchFixtures";

const record = (target: EventTarget, name: string): any[] => {
  const seen: any[] = [];
  target.addEventListener(name, (e) => seen.push((e as CustomEvent).detail));
  return seen;
};

/**
 * master(gain#2) → compressor(comp#3) → makeup compensation(gain#4) → soft clip(shaper#5)
 * → hard clip(shaper#6) → destination#1. Built first, so a patch's nodes start at #7.
 */
const MASTER_CHAIN = [
  "gain#2 -> comp#3", "comp#3 -> gain#4", "gain#4 -> shaper#5", "shaper#5 -> shaper#6", "shaper#6 -> destination#1",
];

let ctx: FakeAudioContext;
const make = (options: { createContext?: () => any } = {}): AudioGraphCore =>
  new AudioGraphCore({ createContext: options.createContext ?? (() => ctx as any) });

describe("AudioGraphCore", () => {
  beforeEach(() => {
    resetNodeIds();
    ctx = new FakeAudioContext();
  });

  describe("コンテキスト", () => {
    it("パッチ投入まで context を作らない", () => {
      let calls = 0;
      make({ createContext: () => { calls++; return ctx as any; } });
      expect(calls).toBe(0);
    });

    it("master → limiter → destination を組む（既定でリミッター有効）", () => {
      const core = make();
      core.setPatch({ nodes: [], voices: [] });
      expect(ctx.snapshot()).toEqual([...MASTER_CHAIN].sort());
    });

    it("options 省略時は既定のコンテキスト供給を使う", () => {
      const registry = globalThis as unknown as Record<string, unknown>;
      const original = registry.AudioContext;
      delete registry.AudioContext;
      try {
        const core = new AudioGraphCore();
        expect(core.setPatch(SIMPLE)).toBe(false);
        expect(core.state).toBe("unsupported");
      } finally {
        if (original === undefined) delete registry.AudioContext;
        else registry.AudioContext = original;
      }
    });

    it("limiter の切り替えで master タップが張り直される", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "analyser", key: "scope", master: true }], voices: [] });
      expect(ctx.snapshot()).toContain("gain#2 -> analyser#7");
      core.setLimiter(false);
      // master を繋ぎ替えてもタップは生き残る
      expect(ctx.snapshot()).toContain("gain#2 -> analyser#7");
      expect(ctx.snapshot()).toContain("gain#2 -> destination#1");
    });

    it("limiter=off で master を destination へ直結する", () => {
      const core = make();
      core.setPatch({ nodes: [], voices: [] });
      core.setLimiter(false);
      expect(ctx.snapshot()).toEqual(["gain#2 -> destination#1"]);
      core.setLimiter(false); // 同値は no-op
      expect(ctx.snapshot()).toEqual(["gain#2 -> destination#1"]);
      core.setLimiter(true);
      expect(ctx.snapshot()).toEqual([...MASTER_CHAIN].sort());
    });

    it("context を作れない環境では unsupported になり setPatch が false を返す", () => {
      const core = make({ createContext: () => null });
      const states = record(core, "wcs-audio:statechange");
      expect(core.setPatch(SIMPLE)).toBe(false);
      expect(core.state).toBe("unsupported");
      expect(core.unsupported).toBe(true);
      expect(core.error).toBe("unsupported");
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "probe", recoverable: false, message: "unsupported",
      });
      expect(states).toEqual(["unsupported"]);
    });

    it("statechange を state に反映する", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const states = record(core, "wcs-audio:statechange");
      ctx.setState("running");
      expect(core.state).toBe("running");
      expect(core.running).toBe(true);
      expect(core.suspended).toBe(false);
      expect(states).toEqual(["running"]);
    });

    it("volume は desired 値としてランプで適用される", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const master = ctx.nodesOf("gain")[0] as any;
      core.setVolume(0.25);
      expect(master.gain.names).toContain("setTargetAtTime");
      expect(master.gain.value).toBe(0.25);
    });

    it("context 未取得でも setVolume は安全", () => {
      const core = make({ createContext: () => null });
      expect(() => core.setVolume(0.5)).not.toThrow();
    });

    it("数値でない volume は既定値に落ちる", () => {
      const core = make();
      core.setPatch(SIMPLE);
      core.setVolume(NaN);
      expect((ctx.nodesOf("gain")[0] as any).gain.value).toBe(0.8);
    });

    it("volume は 0〜1 にクランプされる（範囲外は拒まず端の値になる）", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const master = ctx.nodesOf("gain")[0] as any;
      core.setVolume(80);
      expect(master.gain.value).toBe(1);
      core.setVolume(-3);
      expect(master.gain.value).toBe(0);
      core.setVolume("0.5" as unknown as number);
      expect(master.gain.value).toBe(0.5);
      expect([clampVolume(1.0001), clampVolume(0), clampVolume("x"), clampVolume(null)]).toEqual([1, 0, 0.8, 0.8]);
    });

    it("クランプした volume は context を作る前に書いても master の初期値になる", () => {
      const core = make();
      core.setVolume(80);
      core.setPatch(SIMPLE);
      expect((ctx.nodesOf("gain")[0] as any).gain.value).toBe(1);
    });
  });

  describe("リミッター（耳の保護: -18 dBFS から圧縮、-6 dBFS の天井）", () => {
    it("compressor は -18 dBFS・4:1・ハードニーで、自動メイクアップを打ち消す gain が続く", () => {
      const core = make();
      core.setPatch({ nodes: [], voices: [] });
      const comp = ctx.nodesOf("comp")[0] as any;
      expect([comp.threshold.value, comp.knee.value, comp.ratio.value, comp.attack.value, comp.release.value])
        .toEqual([LIMITER_THRESHOLD, 0, LIMITER_RATIO, 0.003, 0.25]);
      expect([LIMITER_THRESHOLD, LIMITER_RATIO, LIMITER_CEILING]).toEqual([-18, 4, 0.501]);
      // makeup = -0.6 × threshold × (1 − 1/ratio) = +8.1 dB を戻す
      const makeup = ctx.nodesOf("gain")[1] as any;
      expect(makeup.gain.value).toBeCloseTo(10 ** (-8.1 / 20), 6);
      expect(MAKEUP_COMPENSATION).toBeCloseTo(0.3936, 4);
    });

    it("ソフトクリップ（4x オーバーサンプル）の後に、オーバーサンプルしないハードクリップで天井を保証する", () => {
      const core = make();
      core.setPatch({ nodes: [], voices: [] });
      const [soft, hard] = ctx.nodesOf("shaper") as any[];
      expect(soft.oversample).toBe("4x");
      expect(soft.curve).toBe(softClipCurve());
      expect(hard.oversample).toBe("none");
      expect(hard.curve).toBe(hardClipCurve());
    });

    it("ハードクリップのカーブは天井までは恒等、超えると ±0.501 に張り付く（範囲外の入力は端の値）", () => {
      const curve = hardClipCurve();
      const at = (x: number): number => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];
      expect(curve.length % 2).toBe(1);
      expect(at(0)).toBe(0);
      expect(at(0.25)).toBeCloseTo(0.25, 6);
      expect(at(-0.5)).toBeCloseTo(-0.5, 6);
      expect(curve[curve.length - 1]).toBeCloseTo(LIMITER_CEILING, 6);
      expect(curve[0]).toBeCloseTo(-LIMITER_CEILING, 6);
      expect(Math.max(...curve)).toBeLessThanOrEqual(LIMITER_CEILING);
      expect(Math.min(...curve)).toBeGreaterThanOrEqual(-LIMITER_CEILING);
    });

    it("ソフトクリップのカーブは -9 dBFS までは恒等、その先は単調に天井へ近づき、超えない", () => {
      const curve = softClipCurve();
      const at = (x: number): number => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];
      // 0.3125 / 0.4375 are grid points of the 2049-point curve
      expect(at(0)).toBe(0);
      expect(at(0.3125)).toBeCloseTo(0.3125, 6);
      expect(at(-0.3125)).toBeCloseTo(-0.3125, 6);
      expect(at(0.4375)).toBeLessThan(0.4375);
      for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
      expect(Math.max(...curve)).toBeLessThanOrEqual(LIMITER_CEILING);
      expect(curve[curve.length - 1]).toBeGreaterThan(0.5);
    });

    it("limiter の付け外しで 4 段がまとめて出入りする", () => {
      const core = make();
      core.setPatch({ nodes: [], voices: [] });
      core.setLimiter(false);
      expect(ctx.snapshot()).toEqual(["gain#2 -> destination#1"]);
      core.setLimiter(true);
      expect(ctx.snapshot()).toEqual([...MASTER_CHAIN].sort());
      core.dispose();
      expect(ctx.snapshot()).toEqual([]);
    });
  });

  describe("resume / suspend", () => {
    it("resume 成功で state が running になり error が消える", async () => {
      const core = make();
      core.setPatch(SIMPLE);
      await core.resume();
      expect(core.state).toBe("running");
      expect(core.error).toBeNull();
    });

    it("resume の拒否は error になる（throw しない）", async () => {
      const core = make();
      core.setPatch(SIMPLE);
      ctx.resumeRejection = Object.assign(new Error("gesture required"), { name: "NotAllowedError" });
      await expect(core.resume()).resolves.toBeUndefined();
      expect(core.error).toBe("gesture required");
      expect(core.errorInfo).toEqual({
        code: "not-allowed", phase: "start", recoverable: true, message: "gesture required",
      });
    });

    it("message の無い rejection でも既定文言でエラー化する", async () => {
      const core = make();
      core.setPatch(SIMPLE);
      ctx.resumeRejection = {} as Error;
      await core.resume();
      expect(core.error).toBe("Audio error");
      expect(core.errorInfo?.code).toBe("context-error");
    });

    it("suspend で state が suspended に戻る", async () => {
      const core = make();
      core.setPatch(SIMPLE);
      await core.resume();
      await core.suspend();
      expect(core.state).toBe("suspended");
    });

    it("suspend の拒否も error になる", async () => {
      const core = make();
      core.setPatch(SIMPLE);
      ctx.suspendRejection = new Error("cannot suspend");
      await core.suspend();
      expect(core.error).toBe("cannot suspend");
    });

    it("in-flight の resume は dispose で無効化される（_gen）", async () => {
      const core = make();
      core.setPatch(SIMPLE);
      const promise = core.resume();
      core.dispose();
      await promise;
      expect(core.error).toBeNull();
    });

    it("in-flight の resume 拒否も世代で捨てられる", async () => {
      const core = make();
      core.setPatch(SIMPLE);
      ctx.resumeRejection = new Error("late");
      const promise = core.resume();
      core.dispose();
      await promise;
      expect(core.error).toBeNull();
    });

    it("in-flight の suspend は後続の suspend に取って代わられる", async () => {
      const core = make();
      core.setPatch(SIMPLE);
      ctx.suspendRejection = new Error("stale");
      const first = core.suspend();
      ctx.suspendRejection = null;
      const second = core.suspend();
      await Promise.all([first, second]);
      expect(core.error).toBeNull();
    });

    it("context 未取得の resume / suspend は no-op", async () => {
      const core = make({ createContext: () => null });
      await expect(core.resume()).resolves.toBeUndefined();
      await expect(core.suspend()).resolves.toBeUndefined();
    });

    it("resume を持たない context（OfflineAudioContext 相当）でも no-op", async () => {
      const offline = new FakeAudioContext() as any;
      delete offline.resume;
      delete offline.suspend;
      const core = new AudioGraphCore({ createContext: () => offline });
      core.setPatch(SIMPLE);
      await expect(core.resume()).resolves.toBeUndefined();
      await expect(core.suspend()).resolves.toBeUndefined();
    });
  });

  describe("グラフ構築", () => {
    it("入れ子が信号チェーンになり、葉が master へ繋がる", () => {
      const core = make();
      core.setPatch(SIMPLE);
      expect(ctx.snapshot()).toEqual([
        ...MASTER_CHAIN,
        "gain#8 -> gain#2",
        "osc#7 -> gain#8",
      ].sort());
      expect(core.warnings).toEqual([]);
    });

    it("葉が1つも無ければ master へは何も繋がらない", () => {
      const core = make();
      core.setPatch({ nodes: [], voices: [] });
      expect(ctx.snapshot().some((e) => e.endsWith("-> gain#2"))).toBe(false);
    });

    // グラフ形状の正典。ノードは生成順に採番されるので、この1本が
    // 「入れ子＝チェーン」「out の多対一」「param 変調」「master タップ」
    // 「voice の per-voice gain」を同時に固定する。
    //
    //   gain#2  master        comp#3 → gain#4 → shaper#5 → shaper#6  limiter
    //   gain#7  bus           gain#8   delay in    delay#9
    //   gain#10 feedback      gain#11  wet         gain#12 dry   gain#13 out
    //   analyser#14 master タップ      gain#15  その keep-alive
    //   gain#16 per-voice gain
    //   osc#17 / bufsrc#18 → biquad#19 (vcf)
    //   osc#20 + gain#21 = LFO → vcf.frequency
    //   gain#22 env
    it("フルパッチのエッジ集合が期待どおり（out / param / master タップ / voice）", () => {
      const core = make();
      core.setPatch(FULL);
      core.noteOn(60);
      expect(ctx.snapshot()).toEqual([
        ...MASTER_CHAIN,               // master → limiter（4 段）→ 出力
        "analyser#14 -> gain#15",      // master タップの keep-alive（gain 0）
        "biquad#19 -> gain#22",        // vcf → env
        "bufsrc#18 -> biquad#19",      // noise → vcf（out= による多対一）
        "delay#9 -> gain#10",          // delay → feedback
        "delay#9 -> gain#11",          // delay → wet
        "gain#13 -> gain#2",           // delay out → master（葉なので既定接続）
        "gain#15 -> destination#1",    // keep-alive は destination へ（master へ戻すとループ）
        "gain#16 -> gain#7",           // per-voice gain → bus
        "gain#21 -> biquad#19.frequency", // LFO → AudioParam 変調
        "gain#22 -> gain#16",          // env → per-voice gain（out="bus" のボイス外送出）
        "gain#2 -> analyser#14",       // master → タップ（リミッター前）
        "gain#7 -> gain#8",            // bus → delay in（入れ子＝チェーン）
        "gain#8 -> delay#9",
        "gain#8 -> gain#12",           // delay in → dry
        "gain#10 -> delay#9",          // feedback ループ
        "gain#11 -> gain#13",          // wet → out
        "gain#12 -> gain#13",          // dry → out
        "osc#17 -> biquad#19",         // osc → vcf
        "osc#20 -> gain#21",           // LFO osc → depth gain
      ].sort());
      expect(core.warnings).toEqual([]);
    });

    it("解決できない out は warning になり throw しない", () => {
      const core = make();
      const warnings = record(core, "wcs-audio:warnings");
      core.setPatch({ nodes: [{ kind: "osc", key: "o1", out: ["nowhere"] }], voices: [] });
      expect(core.warnings).toHaveLength(1);
      expect(core.warnings[0]).toEqual({
        message: 'out="nowhere": no reachable audio input with that id', key: "o1",
      });
      expect(warnings).toHaveLength(1);
    });

    it("解決できない param 参照も warning になる", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "lfo", key: "l1", param: "ghost.frequency" }], voices: [] });
      expect(core.warnings[0].message).toContain("no reachable AudioParam");
    });

    it("親に存在しない param 名は warning になる", () => {
      const core = make();
      core.setPatch({
        nodes: [{ kind: "gain", key: "g1", children: [{ kind: "lfo", key: "l1", param: "cutoff" }] }],
        voices: [],
      });
      expect(core.warnings[0].message).toContain('param="cutoff": parent has no such AudioParam');
    });

    it("param も out も無い modulator は warning になる", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "lfo", key: "l1" }], voices: [] });
      expect(core.warnings[0].message).toContain("modulator needs param");
    });

    it("未知の kind は warning になり、他のノードは生き残る", () => {
      const core = make();
      core.setPatch({
        nodes: [{ kind: "nope" as any, key: "x" }, { kind: "osc", key: "o1" }],
        voices: [],
      });
      expect(core.warnings[0].message).toContain('unknown node kind "nope"');
      expect(ctx.nodesOf("osc")).toHaveLength(1);
    });

    it("warnings は毎回新しい配列として publish される", () => {
      const core = make();
      const seen = record(core, "wcs-audio:warnings");
      core.setPatch({
        nodes: [{ kind: "lfo", key: "a" }, { kind: "lfo", key: "b" }],
        voices: [],
      });
      expect(seen).toHaveLength(2);
      expect(seen[0]).not.toBe(seen[1]);
    });

    it("out に複数の宛先を書ける", () => {
      const core = make();
      core.setPatch({
        nodes: [
          { kind: "gain", key: "a", id: "a" },
          { kind: "gain", key: "b", id: "b" },
          { kind: "osc", key: "o", out: ["a", "b"] },
        ],
        voices: [],
      });
      const edges = ctx.snapshot();
      expect(edges.filter((e) => e.startsWith("osc#"))).toHaveLength(2);
    });

    it("out=\"id.param\" で任意の AudioParam を駆動できる", () => {
      const core = make();
      core.setPatch({
        nodes: [
          { kind: "biquad", key: "f", id: "vcf" },
          { kind: "lfo", key: "l", out: ["vcf.frequency"] },
        ],
        voices: [],
      });
      expect(ctx.snapshot().some((e) => e.endsWith("biquad#7.frequency"))).toBe(true);
    });
  });

  describe("setPatch の冪等性", () => {
    it("初回は rebuild、同一構造は false、構造変更で true", () => {
      const core = make();
      expect(core.setPatch(SIMPLE)).toBe(true);
      expect(core.setPatch(JSON.parse(JSON.stringify(SIMPLE)))).toBe(false);
      const changed: Patch = {
        nodes: [{
          kind: "osc", key: "o1", params: { frequency: 440 },
          children: [{ kind: "biquad", key: "b1" }],
        }],
        voices: [],
      };
      expect(core.setPatch(changed)).toBe(true);
    });

    it("数値だけが違うパッチは live 更新（rebuild しない）", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const oscCount = ctx.nodesOf("osc").length;
      const rebuilt = core.setPatch({
        nodes: [{
          kind: "osc", key: "o1", params: { frequency: 880 }, props: { type: "square" },
          children: [{ kind: "gain", key: "g1", params: { gain: 0.9 } }],
        }],
        voices: [],
      });
      expect(rebuilt).toBe(false);
      expect(ctx.nodesOf("osc")).toHaveLength(oscCount);
      const osc = ctx.nodesOf("osc")[0] as any;
      expect(osc.frequency.value).toBe(880);
      expect(osc.type).toBe("square");
    });

    it("structureKey は数値を含まない", () => {
      const a = structureKey(SIMPLE);
      const b = structureKey({
        nodes: [{
          kind: "osc", key: "o1", params: { frequency: 9999 },
          children: [{ kind: "gain", key: "g1", params: { gain: 0.1 } }],
        }],
        voices: [],
      });
      expect(a).toBe(b);
    });

    // dispose は終端ではない。要素が DOM 内で動かされただけで二度と鳴らなく
    // なるのは受け入れられないので、次の setPatch で作り直す。
    it("dispose 後の setPatch はグラフを作り直す", () => {
      const core = make();
      core.setPatch(SIMPLE);
      core.dispose();
      expect(ctx.snapshot()).toEqual([]);
      expect(core.setPatch(SIMPLE)).toBe(true);
      expect(ctx.snapshot().length).toBeGreaterThan(0);
    });
  });

  describe("live パラメータ更新", () => {
    it("setParam は全インスタンスへランプで届く", () => {
      const core = make();
      core.setPatch(VOICE);
      core.noteOn(60);
      core.noteOn(64);
      core.setParam("vo", "frequency", 1000);
      const oscs = ctx.nodesOf("osc") as any[];
      expect(oscs).toHaveLength(2);
      for (const osc of oscs) expect(osc.frequency.value).toBe(1000);
    });

    it("有限でない setParam は無視される", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const osc = ctx.nodesOf("osc")[0] as any;
      const before = osc.frequency.calls.length;
      core.setParam("o1", "frequency", NaN);
      expect(osc.frequency.calls.length).toBe(before);
    });

    it("存在しない param 名の setParam は no-op", () => {
      const core = make();
      core.setPatch(SIMPLE);
      expect(() => core.setParam("o1", "nope", 1)).not.toThrow();
    });

    it("context 未取得でも setParam は desired を記録する", () => {
      const core = make({ createContext: () => null });
      core.setPatch(SIMPLE);
      expect(() => core.setParam("o1", "frequency", 880)).not.toThrow();
    });

    it("setProp が type を差し替える", () => {
      const core = make();
      core.setPatch(SIMPLE);
      core.setProp("o1", "type", "sawtooth");
      expect((ctx.nodesOf("osc")[0] as any).type).toBe("sawtooth");
    });

    it("setProp に null を渡すと既定値へ戻り、後から作るインスタンスにも古い値が乗らない", () => {
      const core = make();
      core.setPatch(VOICE);
      core.setProp("vo", "type", "square");
      core.noteOn(60);
      expect((ctx.nodesOf("osc")[0] as any).type).toBe("square");
      core.setProp("vo", "type", null);
      expect((ctx.nodesOf("osc")[0] as any).type).toBe("sine");
      core.noteOn(62);
      expect((ctx.nodesOf("osc")[1] as any).type).toBe("sine");
    });

    it("biquad / lfo の type も null で既定値へ戻る", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "biquad", key: "f1", children: [{ kind: "lfo", key: "l1", param: "frequency" }] }], voices: [] });
      core.setProp("f1", "type", "highpass");
      core.setProp("l1", "type", "square");
      expect(ctx.nodesOf("osc").map((n) => (n as any).type)).toEqual(["square"]);
      core.setProp("f1", "type", null);
      core.setProp("l1", "type", null);
      expect((ctx.nodesOf("biquad")[0] as any).type).toBe("lowpass");
      expect(ctx.nodesOf("osc").map((n) => (n as any).type)).toEqual(["sine"]);
    });

    it("不正な type は無視される（never-throw）", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const osc = ctx.nodesOf("osc")[0] as any;
      Object.defineProperty(osc, "type", {
        get: () => "sine",
        set: () => { throw new TypeError("bad type"); },
      });
      expect(() => core.setProp("o1", "type", "nonsense")).not.toThrow();
    });

    it("rebuild 後の新インスタンスにも desired 値が乗る", () => {
      const core = make();
      core.setPatch(VOICE);
      core.setParam("vo", "detune", 25);
      core.noteOn(60);
      expect((ctx.nodesOf("osc")[0] as any).detune.value).toBe(25);
    });
  });

  describe("ノード種別ごとの構築", () => {
    it("delay は dry / wet / feedback を内部で結線し mix を反映する", () => {
      const core = make();
      core.setPatch({
        nodes: [{ kind: "delay", key: "d", params: { time: 0.5, feedback: 0.6 }, props: { mix: "0.25" } }],
        voices: [],
      });
      const gains = ctx.nodesOf("gain") as any[];
      // master, limiter makeup, input, feedback, wet, dry, output
      expect(gains).toHaveLength(7);
      const wet = gains[4], dry = gains[5];
      expect(wet.gain.value).toBe(0.25);
      expect(dry.gain.value).toBe(0.75);
    });

    it("mix は 0-1 にクランプされる", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "delay", key: "d", props: { mix: "5" } }], voices: [] });
      const gains = ctx.nodesOf("gain") as any[];
      expect(gains[4].gain.value).toBe(1);
      expect(gains[5].gain.value).toBe(0);
    });

    it("shaper は amount からカーブを作る", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "shaper", key: "s", props: { amount: "40" } }], voices: [] });
      const shaper = ctx.nodesOf("shaper")[2] as any;
      expect(shaper.curve).toBeInstanceOf(Float32Array);
      expect(shaper.curve.length).toBe(1024);
      expect(shaper.oversample).toBe("2x");
    });

    it("noise は context ごとにバッファを共有する", () => {
      const core = make();
      core.setPatch({
        nodes: [{ kind: "noise", key: "n1" }, { kind: "noise", key: "n2" }],
        voices: [],
      });
      const sources = ctx.nodesOf("bufsrc") as any[];
      expect(sources[0].buffer).toBe(sources[1].buffer);
      expect(sources[0].loop).toBe(true);
    });

    it("chain 上の env は VCA（入力を持つ）", () => {
      const core = make();
      core.setPatch({
        nodes: [{ kind: "osc", key: "o", children: [{ kind: "env", key: "e" }] }],
        voices: [],
      });
      expect(ctx.snapshot().some((e) => /^osc#\d+ -> gain#\d+$/.test(e))).toBe(true);
      expect(ctx.nodesOf("const")).toHaveLength(0);
    });

    it("param 付きの env は modulator（ConstantSource を持つ）", () => {
      const core = make();
      core.setPatch({
        nodes: [{ kind: "biquad", key: "f", children: [{ kind: "env", key: "e", param: "frequency" }] }],
        voices: [],
      });
      expect(ctx.nodesOf("const")).toHaveLength(1);
      expect(ctx.snapshot().some((e) => e.endsWith(".frequency"))).toBe(true);
    });

    it("env の ADSR 属性が反映される", () => {
      const core = make();
      core.setPatch({
        nodes: [{
          kind: "env", key: "e",
          props: { attack: "0.05", decay: "0.2", sustain: "0.4", release: "1.5", depth: "0.6" },
        }],
        voices: [],
      });
      core.noteOn(60, 1);
      const env = ctx.nodesOf("gain")[2] as any;
      const ramp = env.gain.calls.find((c: any[]) => c[0] === "linearRampToValueAtTime");
      expect(ramp[1]).toBeCloseTo(0.6);        // depth * velocity
      expect(ramp[2]).toBeCloseTo(0.05);       // attack
    });

    it("sustain は 0-1 に、attack/release は下限 0.001 にクランプされる", () => {
      const core = make();
      core.setPatch({
        nodes: [{ kind: "env", key: "e", props: { sustain: "9", attack: "-1", release: "0" } }],
        voices: [],
      });
      core.noteOn(60, 1);
      const env = ctx.nodesOf("gain")[2] as any;
      const ramp = env.gain.calls.find((c: any[]) => c[0] === "linearRampToValueAtTime");
      expect(ramp[2]).toBeCloseTo(0.001);
      const target = env.gain.calls.find((c: any[]) => c[0] === "setTargetAtTime");
      expect(target[1]).toBeCloseTo(1);        // sustain clamped to 1
    });

    it("analyser の fft / smoothing 属性が反映され、不正値は無視される", () => {
      const core = make();
      core.setPatch({
        nodes: [{ kind: "analyser", key: "a", props: { fft: "512", smoothing: "2" } }],
        voices: [],
      });
      const analyser = ctx.nodesOf("analyser")[0] as any;
      expect(analyser.fftSize).toBe(512);
      expect(analyser.smoothingTimeConstant).toBe(1);
      Object.defineProperty(analyser, "fftSize", {
        get: () => 512,
        set: () => { throw new Error("not a power of two"); },
      });
      expect(() => core.setProp("a", "fft", "3")).not.toThrow();
    });
  });

  describe("ノート（モノフォニック / live グラフ）", () => {
    it("note 付き osc が押鍵に追従する", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "osc", key: "o", note: true }], voices: [] });
      core.noteOn(69);
      const osc = ctx.nodesOf("osc")[0] as any;
      expect(osc.frequency.value).toBeCloseTo(440);
      core.noteOn(81);
      expect(osc.frequency.value).toBeCloseTo(880);
    });

    it("glide があると setTargetAtTime で滑る", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "osc", key: "o", note: true, props: { glide: "0.1" } }], voices: [] });
      core.noteOn(69);
      const osc = ctx.nodesOf("osc")[0] as any;
      expect(osc.frequency.names).toContain("setTargetAtTime");
    });

    it("transpose が半音でずらす", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "osc", key: "o", note: true, props: { transpose: "-12" } }], voices: [] });
      core.noteOn(69);
      expect((ctx.nodesOf("osc")[0] as any).frequency.value).toBeCloseTo(220);
    });

    it("レガート: 上の音を離すと下の音へ戻る", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "osc", key: "o", note: true }], voices: [] });
      const osc = ctx.nodesOf("osc")[0] as any;
      core.noteOn(60);
      core.noteOn(72);
      expect(osc.frequency.value).toBeCloseTo(523.25, 1);
      core.noteOff(72);
      expect(osc.frequency.value).toBeCloseTo(261.63, 1);
    });

    it("下の音を離しても鳴っている音は変わらない", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "osc", key: "o", note: true }], voices: [] });
      const osc = ctx.nodesOf("osc")[0] as any;
      core.noteOn(60);
      core.noteOn(72);
      core.noteOff(60);
      expect(osc.frequency.value).toBeCloseTo(523.25, 1);
    });

    it("最後の音を離すとゲートが閉じる", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "osc", key: "o", note: true, children: [{ kind: "env", key: "e" }] }], voices: [] });
      const env = ctx.nodesOf("gain")[2] as any;
      core.noteOn(60);
      core.noteOff(60);
      const targets = env.gain.calls.filter((c: any[]) => c[0] === "setTargetAtTime");
      expect(targets[targets.length - 1][1]).toBe(0);
    });

    it("noteon / noteoff イベントを publish する", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const on = record(core, "wcs-audio:noteon");
      const off = record(core, "wcs-audio:noteoff");
      core.noteOn(60, 0.5);
      core.noteOff(60);
      expect(on).toEqual([{ note: 60, velocity: 0.5 }]);
      expect(off).toEqual([{ note: 60 }]);
    });

    it("context 未取得ならノート操作は無視される", () => {
      const core = make({ createContext: () => null });
      core.setPatch(SIMPLE);
      expect(() => { core.noteOn(60); core.noteOff(60); core.allNotesOff(); core.sweep(); }).not.toThrow();
    });

    it("dispose 後のノート操作は無視される（グラフが無いので）", () => {
      const core = make();
      core.setPatch(SIMPLE);
      core.dispose();
      expect(() => { core.noteOn(60); core.noteOff(60); core.allNotesOff(); }).not.toThrow();
      expect(core.voices).toBe(0);
    });

    it("dispose は共有 context の statechange リスナーも外す", () => {
      const core = make();
      core.setPatch(SIMPLE);
      core.dispose();
      const seen = record(core, "wcs-audio:statechange");
      ctx.setState("running");
      expect(seen).toEqual([]);
    });
  });

  describe("ボイス（ポリフォニー）", () => {
    it("押鍵ごとにグラフを1つ作り、voices を publish する", () => {
      const core = make();
      core.setPatch(VOICE);
      const voices = record(core, "wcs-audio:voices");
      core.noteOn(60);
      core.noteOn(64);
      expect(core.voices).toBe(2);
      expect(voices).toEqual([1, 2]);
      expect(ctx.nodesOf("osc")).toHaveLength(2);
    });

    it("poly 上限で最古のボイスを奪う", () => {
      const core = make();
      core.setPatch(VOICE);
      core.noteOn(60);
      core.noteOn(64);
      core.noteOn(67);
      expect(core.voices).toBe(2);
      expect(core.allocatedVoices).toBe(3); // 奪われた分はテールとして残る
    });

    it("同じ音の再打鍵は前のボイスを解放する", () => {
      const core = make();
      core.setPatch(VOICE);
      core.noteOn(60);
      core.noteOn(60);
      expect(core.voices).toBe(1);
      expect(core.allocatedVoices).toBe(2);
    });

    it("poly が 0 以下でも最低 1 声は鳴る", () => {
      const core = make();
      core.setPatch({ nodes: [], voices: [{ key: "v", poly: 0, nodes: [{ kind: "osc", key: "o", note: true }] }] });
      core.noteOn(60);
      expect(core.voices).toBe(1);
    });

    it("解放済みボイスは audio クロックの前進だけで回収される", () => {
      const core = make();
      core.setPatch(VOICE);
      core.noteOn(60);
      core.noteOff(60);
      expect(core.allocatedVoices).toBe(1);
      ctx.advance(0.5);
      core.sweep();
      expect(core.allocatedVoices).toBe(1);   // freeAt = 0.2*3 + 0.3 = 0.9
      ctx.advance(0.5);
      core.sweep();
      expect(core.allocatedVoices).toBe(0);
    });

    it("ゲート無しパッチには暗黙の安全エンベロープが付く", () => {
      const core = make();
      core.setPatch(GATELESS);
      core.noteOn(60, 0.7);
      const voiceGain = ctx.nodesOf("gain")[2] as any;
      expect(voiceGain.gain.names).toContain("linearRampToValueAtTime");
      const ramp = voiceGain.gain.calls.find((c: any[]) => c[0] === "linearRampToValueAtTime");
      expect(ramp[1]).toBe(0.7);
      expect(ramp[2]).toBeCloseTo(0.005);
    });

    it("ゲート無しボイスも解放され回収される", () => {
      const core = make();
      core.setPatch(GATELESS);
      core.noteOn(60);
      core.noteOff(60);
      ctx.advance(1);
      core.sweep();
      expect(core.allocatedVoices).toBe(0);
    });

    it("note 指定の osc が無ければ全 osc が音程に追従する", () => {
      const core = make();
      core.setPatch({ nodes: [], voices: [{ key: "v", poly: 4, nodes: [{ kind: "osc", key: "o" }] }] });
      core.noteOn(69);
      expect((ctx.nodesOf("osc")[0] as any).frequency.value).toBeCloseTo(440);
    });

    it("allNotesOff は live グラフのゲートも閉じる", () => {
      const core = make();
      core.setPatch({
        nodes: [{ kind: "osc", key: "o", note: true, children: [{ kind: "env", key: "e" }] }],
        voices: [],
      });
      core.noteOn(60);
      const env = ctx.nodesOf("gain")[2] as any;
      core.allNotesOff();
      const targets = env.gain.calls.filter((c: any[]) => c[0] === "setTargetAtTime");
      expect(targets[targets.length - 1][1]).toBe(0);
    });

    it("voices を省略したパッチも扱える", () => {
      const core = make();
      expect(core.setPatch({ nodes: [{ kind: "osc", key: "o" }] })).toBe(true);
      expect(ctx.nodesOf("osc")).toHaveLength(1);
    });

    it("ボイス内の out がどこにも解決しなければ warning になる", () => {
      const core = make();
      core.setPatch({
        nodes: [],
        voices: [{ key: "v", poly: 2, nodes: [{ kind: "osc", key: "o", note: true, out: ["ghost"] }] }],
      });
      core.noteOn(60);
      expect(core.warnings.map((w) => w.message)).toContain(
        'out="ghost": no reachable audio input with that id',
      );
    });

    it("allNotesOff は全ボイスを即座に破棄する", () => {
      const core = make();
      core.setPatch(VOICE);
      core.noteOn(60);
      core.noteOn(64);
      core.allNotesOff();
      expect(core.allocatedVoices).toBe(0);
      expect(core.voices).toBe(0);
    });

    it("rebuild は発音中のボイスを切る", () => {
      const core = make();
      core.setPatch(VOICE);
      core.noteOn(60);
      expect(core.voices).toBe(1);
      core.setPatch({ ...VOICE, nodes: [{ kind: "gain", key: "extra" }] });
      expect(core.voices).toBe(0);
    });

    it("liveNoteHeld は live グラフ（ボイスの外）で押さえた音が鳴っているか", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "osc", key: "o", note: true }], voices: [] });
      expect(core.liveNoteHeld).toBe(false);
      core.noteOn(60);
      core.noteOn(64);
      expect([core.liveNoteHeld, core.voices]).toEqual([true, 0]);
      core.noteOff(60);
      expect(core.liveNoteHeld).toBe(true);
      core.noteOff(64);
      expect(core.liveNoteHeld).toBe(false);
      core.noteOn(60);
      core.setPatch({ nodes: [{ kind: "osc", key: "o", note: true }, { kind: "gain", key: "g" }], voices: [] });
      expect(core.liveNoteHeld).toBe(false);
    });

    it("live グラフに env も note の osc も無ければ、押鍵は live グラフで鳴っていない（音はボイスにある）", () => {
      const core = make();
      core.setPatch(VOICE);
      core.noteOn(60);
      expect([core.liveNoteHeld, core.voices]).toEqual([false, 1]);
      const gated = make();
      gated.setPatch({ nodes: [{ kind: "osc", key: "o", children: [{ kind: "env", key: "e" }] }], voices: [] });
      gated.noteOn(60);
      expect(gated.liveNoteHeld).toBe(true);
    });

    it("context が無ければ liveNoteHeld は false", () => {
      const core = make({ createContext: () => null });
      expect(core.liveNoteHeld).toBe(false);
    });

    it("ボイスの out 送出は per-voice gain を経由する（スティール時に一括で消える）", () => {
      const core = make();
      core.setPatch(FULL);
      core.noteOn(60);
      const edges = ctx.snapshot();
      // env は bus へ「直接」ではなく per-voice gain 経由で届く
      expect(edges).toContain("gain#22 -> gain#16");
      expect(edges).toContain("gain#16 -> gain#7");
      expect(edges).not.toContain("gain#22 -> gain#7");
    });
  });

  describe("analyser の読み出し", () => {
    it("sample は毎回新しい配列を返す（producer snapshot contract）", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "analyser", key: "a" }], voices: [] });
      const first = core.sample("a");
      const second = core.sample("a");
      expect(first).toBeInstanceOf(Uint8Array);
      expect(first).not.toBe(second);
      expect(first!.length).toBe(2048);
      expect(first![0]).toBe(128);
    });

    it("fft モードは frequencyBinCount 長の配列を返す", () => {
      const core = make();
      core.setPatch({ nodes: [{ kind: "analyser", key: "a" }], voices: [] });
      const data = core.sample("a", "fft");
      expect(data!.length).toBe(1024);
      expect(data![0]).toBe(7);
    });

    it("analyser でないキーは null", () => {
      const core = make();
      core.setPatch(SIMPLE);
      expect(core.sample("o1")).toBeNull();
      expect(core.sample("missing")).toBeNull();
    });

    it("rekickTaps が master タップを張り直す", () => {
      const core = make();
      core.setPatch(FULL);
      const before = ctx.snapshot();
      core.rekickTaps();
      expect(ctx.snapshot()).toEqual(before);
    });

    it("context 未取得の rekickTaps は no-op", () => {
      const core = make({ createContext: () => null });
      expect(() => core.rekickTaps()).not.toThrow();
    });

    it("resume 後にタップが張り直される", async () => {
      const core = make();
      core.setPatch(FULL);
      await core.resume();
      expect(ctx.snapshot()).toContain("gain#2 -> analyser#14");
    });
  });

  describe("dispose は変えたものを publish する（timing-and-firing-contract §22）", () => {
    it("発音中の dispose で voices が 0 に、state が suspended に戻り、それぞれのイベントが出る", async () => {
      const core = make();
      core.setPatch(VOICE);
      await core.resume();
      core.noteOn(60);
      expect([core.voices, core.running]).toEqual([1, true]);
      const voices = record(core, "wcs-audio:voices");
      const states = record(core, "wcs-audio:statechange");
      core.dispose();
      expect(voices).toEqual([0]);
      expect(states).toEqual(["suspended"]);
      expect([core.voices, core.state, core.running, core.suspended]).toEqual([0, "suspended", false, true]);
    });

    it("再接続（次の setPatch）で context の本当の state と、次の音の voices の立ち上がりが届く", async () => {
      const core = make();
      core.setPatch(VOICE);
      await core.resume();
      core.noteOn(60);
      core.dispose();
      const voices = record(core, "wcs-audio:voices");
      const states = record(core, "wcs-audio:statechange");
      core.setPatch(VOICE);
      expect(states).toEqual(["running"]);
      core.noteOn(64);
      expect(voices).toEqual([1]);
    });

    it("何も変えない dispose は何も発火しない", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const voices = record(core, "wcs-audio:voices");
      const states = record(core, "wcs-audio:statechange");
      core.dispose();
      expect(voices).toEqual([]);
      expect(states).toEqual([]);
    });

    it("unsupported は dispose しても unsupported のまま（手放す context が無い）", () => {
      const core = make({ createContext: () => null });
      core.setPatch(SIMPLE);
      const states = record(core, "wcs-audio:statechange");
      core.dispose();
      expect(states).toEqual([]);
      expect(core.unsupported).toBe(true);
    });
  });

  describe("dispose", () => {
    it("全ノードを disconnect し、全ソースを stop する", () => {
      const core = make();
      core.setPatch(FULL);
      core.noteOn(60);
      core.dispose();
      const sources = [...ctx.nodesOf("osc"), ...ctx.nodesOf("bufsrc"), ...ctx.nodesOf("const")] as any[];
      expect(sources.length).toBeGreaterThan(0);
      for (const s of sources) expect(s.stopped).toBe(true);
      expect(ctx.snapshot()).toEqual([]);
    });

    it("二重 dispose は安全", () => {
      const core = make();
      core.setPatch(SIMPLE);
      core.dispose();
      expect(() => core.dispose()).not.toThrow();
    });

    it("context 未取得での dispose も安全", () => {
      const core = make({ createContext: () => null });
      expect(() => core.dispose()).not.toThrow();
    });

    it("既に停止したソースの二重 stop を飲み込む", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const osc = ctx.nodesOf("osc")[0] as any;
      osc.stop();
      expect(() => core.dispose()).not.toThrow();
    });
  });

  describe("observe / ready", () => {
    it("observe はパッチを適用し ready を返す", async () => {
      const core = make();
      await expect(core.observe(SIMPLE)).resolves.toBeUndefined();
      expect(ctx.nodesOf("osc")).toHaveLength(1);
      expect(core.ready).toBeInstanceOf(Promise);
    });
  });

  describe("wcBindable 宣言", () => {
    it("AudioNode を1つも公開しない（ADR-14 G2）", () => {
      const names = AudioGraphCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual([
        "state", "running", "suspended", "unsupported", "voices",
        "noteOn", "noteOff", "warnings", "error", "errorInfo",
      ]);
      const semantics = new Set(AudioGraphCore.wcBindable.properties.map((p) => p.semantics));
      expect(semantics).toEqual(new Set(["state", "event"]));
    });

    it("state 由来の派生 getter が一致する", () => {
      const byName = new Map(AudioGraphCore.wcBindable.properties.map((p) => [p.name, p]));
      const running = new CustomEvent("x", { detail: "running" });
      expect(byName.get("running")!.getter!(running)).toBe(true);
      expect(byName.get("suspended")!.getter!(running)).toBe(false);
      expect(byName.get("unsupported")!.getter!(new CustomEvent("x", { detail: "unsupported" }))).toBe(true);
    });

    it("commands は resume / suspend / noteOn / noteOff / allNotesOff", () => {
      expect(AudioGraphCore.wcBindable.commands?.map((c) => c.name)).toEqual([
        "resume", "suspend", "noteOn", "noteOff", "allNotesOff",
      ]);
    });
  });

  describe("同値ガード", () => {
    it("state は変化時だけ発火する", () => {
      const core = make();
      core.setPatch(SIMPLE);
      const seen = record(core, "wcs-audio:statechange");
      ctx.setState("running");
      ctx.setState("running");
      expect(seen).toEqual(["running"]);
    });

    it("voices は変化時だけ発火する", () => {
      const core = make();
      core.setPatch(VOICE);
      const seen = record(core, "wcs-audio:voices");
      core.noteOn(60);
      core.setParam("vo", "detune", 1);
      expect(seen).toEqual([1]);
    });

    it("error は同じ値なら再発火せず、errorInfo も連動する", async () => {
      const core = make();
      core.setPatch(SIMPLE);
      ctx.resumeRejection = new Error("same");
      const errors = record(core, "wcs-audio:error");
      const infos = record(core, "wcs-audio:error-info-changed");
      await core.resume();
      await core.resume();
      expect(errors).toEqual(["same"]);
      expect(infos).toHaveLength(2); // errorInfo は毎遷移で新規オブジェクト
      ctx.resumeRejection = null;
      await core.resume();
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });
  });

  it("FakeAudioParam は自動化呼び出しを順に記録する", () => {
    const param = new FakeAudioParam(1, "p");
    param.cancelScheduledValues(0);
    param.setValueAtTime(2, 0);
    expect(param.names).toEqual(["cancelScheduledValues", "setValueAtTime"]);
  });
});
