import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { WcsAudio } from "../src/components/Audio";
import { WcsVoice } from "../src/components/Voice";
import { WcsAnalyser, WcsBiquad, WcsGain, WcsOsc } from "../src/components/nodes";
import { AudioNodeShell, findAudioRoot } from "../src/components/AudioNodeShell";
import { AudioGraphCore } from "../src/core/AudioGraphCore";
import { compilePatch, graphChildren } from "../src/patch/compilePatch";
import { registerComponents } from "../src/registerComponents";
import { setConfig } from "../src/config";
import { FakeAudioContext, resetNodeIds } from "./FakeAudioContext";

let ctx: FakeAudioContext;

/** Mount markup and let the root's connect-time compile run. */
const mount = async (html: string): Promise<WcsAudio> => {
  document.body.innerHTML = html;
  const root = document.querySelector("wcs-audio") as WcsAudio;
  await root.connectedCallbackPromise;
  return root;
};

/** Let the microtask-coalesced rebuild run. */
const settle = (): Promise<void> => Promise.resolve().then(() => Promise.resolve());

describe("audio custom elements", () => {
  beforeAll(() => {
    registerComponents();
  });

  beforeEach(() => {
    resetNodeIds();
    ctx = new FakeAudioContext();
    setConfig({ createContext: () => ctx as unknown as BaseAudioContext });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("パッチのコンパイル", () => {
    it("入れ子がそのまま patch の children になる", async () => {
      const root = await mount(`
        <wcs-audio>
          <wcs-osc type="sawtooth" frequency="220">
            <wcs-biquad id="vcf" frequency="800"></wcs-biquad>
          </wcs-osc>
        </wcs-audio>`);
      const patch = root.patch;
      expect(patch.nodes).toHaveLength(1);
      expect(patch.nodes[0].kind).toBe("osc");
      expect(patch.nodes[0].params).toEqual({ frequency: 220, detune: 0 });
      expect(patch.nodes[0].props).toEqual({ type: "sawtooth" });
      expect(patch.nodes[0].children![0].kind).toBe("biquad");
      expect(patch.nodes[0].children![0].id).toBe("vcf");
    });

    it("普通の HTML は貫通して降りる（パッチをコントロールと混ぜて書ける）", async () => {
      const root = await mount(`
        <wcs-audio>
          <div class="panel"><label><wcs-osc></wcs-osc></label></div>
        </wcs-audio>`);
      expect(root.patch.nodes).toHaveLength(1);
    });

    it("入れ子の <wcs-audio> はそのパッチに取り込まれない", async () => {
      const root = await mount(`
        <wcs-audio id="outer">
          <wcs-osc></wcs-osc>
          <div><wcs-audio id="inner"><wcs-gain></wcs-gain></wcs-audio></div>
        </wcs-audio>`);
      expect(root.patch.nodes).toHaveLength(1);
      expect(root.patch.nodes[0].kind).toBe("osc");
    });

    it("out / param / note / master 属性が patch に写る", async () => {
      const root = await mount(`
        <wcs-audio>
          <wcs-osc note out="bus vcf.frequency"></wcs-osc>
          <wcs-lfo param="frequency"></wcs-lfo>
          <wcs-analyser master></wcs-analyser>
        </wcs-audio>`);
      const [osc, lfo, analyser] = root.patch.nodes;
      expect(osc.note).toBe(true);
      expect(osc.out).toEqual(["bus", "vcf.frequency"]);
      expect(lfo.param).toBe("frequency");
      expect(analyser.master).toBe(true);
    });

    it("空の out / id / param 属性は無視される", async () => {
      const root = await mount(`
        <wcs-audio><wcs-osc out="" id="" param=""></wcs-osc></wcs-audio>`);
      const node = root.patch.nodes[0];
      expect(node.out).toBeUndefined();
      expect(node.id).toBeUndefined();
      expect(node.param).toBeUndefined();
    });

    it("<wcs-voice> は voices として取り出され、その中身は nodes に混ざらない", async () => {
      const root = await mount(`
        <wcs-audio>
          <wcs-voice poly="4"><wcs-osc note></wcs-osc></wcs-voice>
          <wcs-gain id="bus"></wcs-gain>
        </wcs-audio>`);
      expect(root.patch.voices).toHaveLength(1);
      expect(root.patch.voices![0].poly).toBe(4);
      expect(root.patch.voices![0].nodes).toHaveLength(1);
      expect(root.patch.nodes).toHaveLength(1);
      expect(root.patch.nodes[0].kind).toBe("gain");
    });

    it("チェーンの中に入れた <wcs-voice> は無視される", async () => {
      const root = await mount(`
        <wcs-audio>
          <wcs-gain><wcs-voice><wcs-osc></wcs-osc></wcs-voice></wcs-gain>
        </wcs-audio>`);
      expect(root.patch.nodes[0].children).toBeUndefined();
      expect(root.patch.voices).toHaveLength(0);
    });

    it("poly の既定は 8、不正値でも 8", () => {
      const voice = document.createElement("wcs-voice") as WcsVoice;
      expect(voice.poly).toBe(8);
      voice.setAttribute("poly", "0");
      expect(voice.poly).toBe(8);
      voice.setAttribute("poly", "abc");
      expect(voice.poly).toBe(8);
      voice.poly = 3;
      expect(voice.poly).toBe(3);
    });

    it("graphChildren は audio 要素で降下を止める", async () => {
      const root = await mount(`
        <wcs-audio><wcs-gain><wcs-osc></wcs-osc></wcs-gain></wcs-audio>`);
      expect(graphChildren(root)).toHaveLength(1);
    });

    it("compilePatch は要素から直接呼べる（ヘッドレス経路）", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      expect(compilePatch(root).nodes).toHaveLength(1);
    });
  });

  describe("グラフの生成", () => {
    it("接続時にグラフが組まれる", async () => {
      await mount(`<wcs-audio><wcs-osc frequency="440"><wcs-gain gain="0.5"></wcs-gain></wcs-osc></wcs-audio>`);
      expect(ctx.snapshot()).toEqual([
        "comp#3 -> destination#1",
        "gain#2 -> comp#3",
        "gain#5 -> gain#2",
        "osc#4 -> gain#5",
      ]);
    });

    it("切断で全ノードが解放される", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      root.remove();
      expect(ctx.snapshot()).toEqual([]);
      expect((ctx.nodesOf("osc")[0] as any).stopped).toBe(true);
    });

    it("Web Audio 非対応なら unsupported になり throw しない", async () => {
      setConfig({ createContext: () => null });
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      expect(root.unsupported).toBe(true);
      expect(root.error).toBe("unsupported");
    });
  });

  describe("live 更新 vs rebuild", () => {
    it("数値属性の変更は rebuild しない", async () => {
      const root = await mount(`<wcs-audio><wcs-osc frequency="440"></wcs-osc></wcs-audio>`);
      const osc = document.querySelector("wcs-osc")!;
      const before = ctx.created.length;
      osc.setAttribute("frequency", "880");
      await settle();
      expect(ctx.created.length).toBe(before);
      expect((ctx.nodesOf("osc")[0] as any).frequency.value).toBe(880);
      expect(root.voices).toBe(0);
    });

    it("数値属性を消すと既定値へ戻る（rebuild しない）", async () => {
      await mount(`<wcs-audio><wcs-osc frequency="880"></wcs-osc></wcs-audio>`);
      const osc = document.querySelector("wcs-osc")!;
      const before = ctx.created.length;
      osc.removeAttribute("frequency");
      await settle();
      expect(ctx.created.length).toBe(before);
      expect((ctx.nodesOf("osc")[0] as any).frequency.value).toBe(440);
    });

    it("数値でない属性値は無視される", async () => {
      await mount(`<wcs-audio><wcs-osc frequency="440"></wcs-osc></wcs-audio>`);
      const osc = document.querySelector("wcs-osc")!;
      osc.setAttribute("frequency", "abc");
      await settle();
      expect((ctx.nodesOf("osc")[0] as any).frequency.value).toBe(440);
    });

    it("非数値属性（type）の変更も rebuild しない", async () => {
      await mount(`<wcs-audio><wcs-osc type="sine"></wcs-osc></wcs-audio>`);
      const osc = document.querySelector("wcs-osc")!;
      const before = ctx.created.length;
      osc.setAttribute("type", "square");
      await settle();
      expect(ctx.created.length).toBe(before);
      expect((ctx.nodesOf("osc")[0] as any).type).toBe("square");
    });

    it("構造属性（out）の変更は rebuild する", async () => {
      await mount(`
        <wcs-audio><wcs-gain id="bus"></wcs-gain><wcs-osc></wcs-osc></wcs-audio>`);
      const osc = document.querySelector("wcs-osc")!;
      osc.setAttribute("out", "bus");
      await settle();
      const oscEdge = ctx.snapshot().find((e) => e.startsWith("osc#"))!;
      expect(oscEdge).toMatch(/^osc#\d+ -> gain#\d+$/);
      // master(gain#2) ではなく bus へ向くようになった
      expect(oscEdge).not.toContain("-> gain#2");
    });

    it("audio タグの追加で rebuild する", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      expect(ctx.nodesOf("osc")).toHaveLength(1);
      root.appendChild(document.createElement("wcs-gain"));
      await settle();
      // rebuild したので osc は作り直されている
      expect(ctx.nodesOf("osc")).toHaveLength(2);
      expect(root.patch.nodes).toHaveLength(2);
    });

    it("audio タグの削除で rebuild する", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc><wcs-gain></wcs-gain></wcs-audio>`);
      document.querySelector("wcs-gain")!.remove();
      await settle();
      expect(root.patch.nodes).toHaveLength(1);
    });

    it("無関係な DOM 変更では rebuild しない（発音中の音を切らない）", async () => {
      const root = await mount(`
        <wcs-audio>
          <wcs-voice poly="4"><wcs-osc note><wcs-env></wcs-env></wcs-osc></wcs-voice>
        </wcs-audio>`);
      root.noteOn(60);
      expect(root.voices).toBe(1);

      // コントロール用の DOM を足す — 原型ではこれで音が切れていた。
      const div = document.createElement("div");
      div.innerHTML = "<label><input type='range'></label>";
      root.appendChild(div);
      await settle();

      expect(root.voices).toBe(1);
    });

    // 連続した DOM 編集は1回のグラフ再構築に束ねられる。setPatch 自体は
    // 2 経路（各要素の connectedCallback と MutationObserver の配送）から
    // 届くので複数回呼ばれうるが、構造ハッシュが一致する2回目以降は
    // rebuild しない — だから実際にノードが作り直されるのは1度だけ。
    it("連続した DOM 変更は1回の rebuild に束ねられる", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      const spy = vi.spyOn(root.audioCore, "setPatch");
      root.appendChild(document.createElement("wcs-gain"));
      root.appendChild(document.createElement("wcs-gain"));
      root.appendChild(document.createElement("wcs-gain"));
      await settle();
      expect(spy.mock.results.filter((r) => r.value === true)).toHaveLength(1);
      expect(ctx.nodesOf("osc")).toHaveLength(2);
    });

    it("切断済みの要素では queue された rebuild が走らない", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      const spy = vi.spyOn(root.audioCore, "setPatch");
      root.requestRebuild();
      root.remove();
      await settle();
      expect(spy).not.toHaveBeenCalled();
    });

    it("プロパティ代入は属性より優先され、属性書き込みが優先を取り戻す", async () => {
      await mount(`<wcs-audio><wcs-osc frequency="440"></wcs-osc></wcs-audio>`);
      const osc = document.querySelector("wcs-osc") as WcsOsc & { frequency: number };
      osc.frequency = 900;
      expect(osc.frequency).toBe(900);
      expect((ctx.nodesOf("osc")[0] as any).frequency.value).toBe(900);
      osc.setAttribute("frequency", "500");
      expect(osc.frequency).toBe(500);
    });

    it("非数値プロパティのアクセサは属性を書く", () => {
      const osc = document.createElement("wcs-osc") as WcsOsc & { type: string };
      osc.type = "square";
      expect(osc.getAttribute("type")).toBe("square");
      expect(osc.type).toBe("square");
    });

    it("同じ値への属性書き込みは何もしない", async () => {
      const root = await mount(`<wcs-audio><wcs-osc frequency="440"></wcs-osc></wcs-audio>`);
      const spy = vi.spyOn(root.audioCore, "setParam");
      document.querySelector("wcs-osc")!.setAttribute("frequency", "440");
      expect(spy).not.toHaveBeenCalled();
    });

    it("ルートの外にあるノードは Core に触らない", () => {
      const osc = document.createElement("wcs-osc") as WcsOsc & { frequency: number };
      document.body.appendChild(osc);
      expect(() => { osc.frequency = 100; }).not.toThrow();
      expect(findAudioRoot(osc)).toBeNull();
    });
  });

  describe("ルートの属性", () => {
    it("volume が master に届く", async () => {
      const root = await mount(`<wcs-audio volume="0.3"><wcs-osc></wcs-osc></wcs-audio>`);
      expect((ctx.nodesOf("gain")[0] as any).gain.value).toBe(0.3);
      root.setAttribute("volume", "0.9");
      expect((ctx.nodesOf("gain")[0] as any).gain.value).toBe(0.9);
    });

    it("volume の既定は 0.8、不正値でも 0.8", async () => {
      const root = await mount(`<wcs-audio volume="abc"><wcs-osc></wcs-osc></wcs-audio>`);
      expect(root.volume).toBe(0.8);
      root.volume = 0.5;
      expect(root.getAttribute("volume")).toBe("0.5");
    });

    it("limiter=off でリミッターを外せる", async () => {
      const root = await mount(`<wcs-audio limiter="off"><wcs-osc></wcs-osc></wcs-audio>`);
      expect(root.limiter).toBe(false);
      expect(ctx.snapshot()).toContain("gain#2 -> destination#1");
      root.limiter = true;
      expect(root.getAttribute("limiter")).toBe("on");
      expect(ctx.snapshot()).toContain("gain#2 -> comp#3");
    });

    it("resume-on-gesture は既定 on で、最初のジェスチャで resume する", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      expect(root.resumeOnGesture).toBe(true);
      document.dispatchEvent(new Event("pointerdown"));
      await settle();
      expect(root.state).toBe("running");
    });

    it("resume-on-gesture=off ならジェスチャで resume しない", async () => {
      const root = await mount(`<wcs-audio resume-on-gesture="off"><wcs-osc></wcs-osc></wcs-audio>`);
      expect(root.resumeOnGesture).toBe(false);
      document.dispatchEvent(new Event("keydown"));
      await settle();
      expect(root.state).toBe("suspended");
    });

    it("resume-on-gesture は動的に付け外しできる", async () => {
      const root = await mount(`<wcs-audio resume-on-gesture="off"><wcs-osc></wcs-osc></wcs-audio>`);
      root.resumeOnGesture = true;
      document.dispatchEvent(new Event("keydown"));
      await settle();
      expect(root.state).toBe("running");
      root.resumeOnGesture = false;
      await ctx.suspend();
      document.dispatchEvent(new Event("keydown"));
      await settle();
      expect(root.state).toBe("suspended");
    });

    it("切断でジェスチャのリスナも外れる（グローバル副作用を残さない）", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      root.remove();
      document.dispatchEvent(new Event("pointerdown"));
      await settle();
      expect(ctx.state).toBe("suspended");
    });

    it("同じ値への属性書き込みは何もしない", async () => {
      const root = await mount(`<wcs-audio volume="0.5"><wcs-osc></wcs-osc></wcs-audio>`);
      const spy = vi.spyOn(root.audioCore, "setVolume");
      root.setAttribute("volume", "0.5");
      expect(spy).not.toHaveBeenCalled();
    });

    it("limiter プロパティは on/off の両方を属性へ書く", () => {
      const root = document.createElement("wcs-audio") as WcsAudio;
      root.limiter = false;
      expect(root.getAttribute("limiter")).toBe("off");
      root.limiter = true;
      expect(root.getAttribute("limiter")).toBe("on");
    });

    it("resume-on-gesture の重複バインドは1回で足りる", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      // 既に bind 済みの状態でもう一度 on を書いても二重購読にならない。
      root.setAttribute("resume-on-gesture", "on");
      document.dispatchEvent(new Event("pointerdown"));
      await settle();
      expect(root.state).toBe("running");
      root.remove();
      await ctx.suspend();
      document.dispatchEvent(new Event("pointerdown"));
      await settle();
      expect(ctx.state).toBe("suspended");
    });

    it("再接続でも observer と Core が張り直される", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      root.remove();
      document.body.appendChild(root);
      await root.connectedCallbackPromise;
      root.appendChild(document.createElement("wcs-gain"));
      await settle();
      expect(root.patch.nodes).toHaveLength(2);
      expect(ctx.snapshot().length).toBeGreaterThan(0);
    });
  });

  describe("ルートのコマンドと委譲", () => {
    it("noteOn / noteOff / allNotesOff を Core へ素通しする", async () => {
      const root = await mount(`
        <wcs-audio><wcs-voice poly="4"><wcs-osc note><wcs-env></wcs-env></wcs-osc></wcs-voice></wcs-audio>`);
      root.noteOn(60, 0.5);
      root.noteOn(64);
      expect(root.voices).toBe(2);
      root.noteOff(60);
      expect(root.voices).toBe(1);
      root.allNotesOff();
      expect(root.voices).toBe(0);
    });

    it("resume / suspend を Core へ素通しする", async () => {
      const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
      await root.resume();
      expect(root.running).toBe(true);
      await root.suspend();
      expect(root.suspended).toBe(true);
    });

    it("観測値を Core からそのまま返す", async () => {
      const root = await mount(`<wcs-audio><wcs-osc out="nowhere"></wcs-osc></wcs-audio>`);
      expect(root.state).toBe("suspended");
      expect(root.voices).toBe(0);
      expect(root.warnings).toHaveLength(1);
      expect(root.error).toBeNull();
      expect(root.errorInfo).toBeNull();
      expect(root.audioCore).toBeInstanceOf(AudioGraphCore);
    });
  });

  describe("<wcs-analyser>", () => {
    it("sample が frame イベントを出し、毎回新しい配列を返す", async () => {
      await mount(`<wcs-audio><wcs-analyser master></wcs-analyser></wcs-audio>`);
      const analyser = document.querySelector("wcs-analyser") as WcsAnalyser;
      const frames: Uint8Array[] = [];
      analyser.addEventListener("wcs-analyser:frame", (e) => frames.push((e as CustomEvent).detail));

      const first = analyser.sample();
      const second = analyser.sample("fft");

      expect(first).toBeInstanceOf(Uint8Array);
      expect(first).not.toBe(second);
      expect(second!.length).toBe(1024);
      expect(frames).toHaveLength(2);
    });

    it("ルートの外では null を返し frame も出さない", () => {
      const analyser = document.createElement("wcs-analyser") as WcsAnalyser;
      document.body.appendChild(analyser);
      const frames: unknown[] = [];
      analyser.addEventListener("wcs-analyser:frame", () => frames.push(1));
      expect(analyser.sample()).toBeNull();
      expect(frames).toHaveLength(0);
    });

    it("frame は occurrence として宣言される", () => {
      const frame = WcsAnalyser.wcBindable.properties.find((p) => p.name === "frame")!;
      expect(frame.semantics).toBe("event");
      expect(frame.getter!(new CustomEvent("x", { detail: 42 }))).toBe(42);
      expect(WcsAnalyser.wcBindable.commands?.map((c) => c.name)).toEqual(["sample"]);
    });
  });

  describe("wcBindable 宣言", () => {
    it("ルートは Core の properties を継承し inputs を足す", () => {
      expect(WcsAudio.wcBindable.properties).toBe(AudioGraphCore.wcBindable.properties);
      expect(WcsAudio.wcBindable.inputs?.map((i) => i.name)).toEqual([
        "volume", "limiter", "resumeOnGesture",
      ]);
      expect(WcsAudio.hasConnectedCallbackPromise).toBe(true);
    });

    it("ノードタグは観測面を持たない純粋な入力ノード", () => {
      expect(WcsOsc.wcBindable.properties).toEqual([]);
      expect(WcsOsc.wcBindable.commands).toEqual([]);
      expect(WcsOsc.wcBindable.inputs?.map((i) => i.name)).toEqual([
        "frequency", "detune", "type", "glide", "transpose",
      ]);
      expect(WcsGain.wcBindable.inputs?.map((i) => i.name)).toEqual(["gain"]);
      expect(WcsBiquad.wcBindable.inputs?.map((i) => i.name)).toEqual([
        "frequency", "q", "gain", "detune", "type",
      ]);
    });

    it("observedAttributes は params + props + 構造属性", () => {
      expect(WcsGain.observedAttributes).toEqual([
        "gain", "id", "out", "param", "note", "master", "poly",
      ]);
    });

    it("<wcs-voice> は wcBindable を宣言しない（poly は構造属性）", () => {
      expect((WcsVoice as unknown as { wcBindable?: unknown }).wcBindable).toBeUndefined();
      expect(WcsVoice.observedAttributes).toEqual(["poly"]);
    });

    it("AudioNodeShell はノードの識別に使う既定 kind を持つ", () => {
      expect(AudioNodeShell.kind).toBe("gain");
    });
  });

  describe("upgrade 前のプロパティ代入", () => {
    it("upgrade 前に書かれた値が取り込まれる", async () => {
      const root = document.createElement("wcs-audio") as WcsAudio;
      const osc = document.createElement("wcs-osc") as WcsOsc & { type: string };
      // 未 upgrade 相当: own データプロパティで accessor をシャドウする
      Object.defineProperty(osc, "type", { value: "triangle", writable: true, configurable: true });
      root.appendChild(osc);
      document.body.appendChild(root);
      await root.connectedCallbackPromise;
      expect(osc.getAttribute("type")).toBe("triangle");
    });
  });
});
