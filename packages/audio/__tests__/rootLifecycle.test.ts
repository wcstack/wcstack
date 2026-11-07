import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { WcsAudio } from "../src/components/Audio";
import { attributeCause } from "../src/components/AudioNodeShell";
import { defaultCreateContext, releaseSharedContext } from "../src/core/audioContext";
import { registerComponents } from "../src/registerComponents";
import { setConfig } from "../src/config";
import { FakeAudioContext, resetNodeIds } from "./FakeAudioContext";

// <wcs-audio> の生存期間まわりの 3 つの約束（音楽室の継ぎ目アプリが見つけたもの）:
//   - 切断は変えた出力を publish する（timing-and-firing-contract §22）
//   - 既定の context は最初のユーザー操作まで作らない（ブラウザの警告を出さない）
//   - rebuild が発音中のボイスを切ったら、ルートごとに 1 回だけ言う（[wcs/audio-voices-cut]）

let ctx: FakeAudioContext;

const mount = async (html: string): Promise<WcsAudio> => {
  document.body.innerHTML = html;
  const root = document.querySelector("wcs-audio") as WcsAudio;
  await root.connectedCallbackPromise;
  return root;
};

/** Let the microtask-coalesced rebuild run. */
const settle = (): Promise<void> => Promise.resolve().then(() => Promise.resolve());
/** The next task: where a graph that waited for a gesture is built once the gesture ends. */
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const gesture = (type: string): boolean => document.dispatchEvent(new Event(type));

const record = (target: EventTarget, name: string): any[] => {
  const seen: any[] = [];
  target.addEventListener(name, (e) => seen.push((e as CustomEvent).detail));
  return seen;
};

const VOICE_PATCH = `<wcs-audio><wcs-voice poly="4"><wcs-osc note><wcs-env></wcs-env></wcs-osc></wcs-voice></wcs-audio>`;

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

describe("切断は変えたものを publish する（§22）", () => {
  it("発音中に文書から外すと voices が 0、state が suspended になり、そのイベントが出る", async () => {
    const root = await mount(VOICE_PATCH);
    await root.resume();
    root.noteOn(60);
    expect([root.voices, root.running]).toEqual([1, true]);
    const voices = record(root, "wcs-audio:voices");
    const states = record(root, "wcs-audio:statechange");

    root.remove();

    expect(voices).toEqual([0]);
    expect(states).toEqual(["suspended"]);
    expect([root.voices, root.state, root.running, root.suspended]).toEqual([0, "suspended", false, true]);
    expect(root.debugStates).toEqual(["suspended"]);
  });

  it("戻ってきたら running が届き、次の音の voices の立ち上がりも同値ガードに食われない", async () => {
    const root = await mount(VOICE_PATCH);
    await root.resume();
    root.noteOn(60);
    root.remove();
    const voices = record(root, "wcs-audio:voices");
    const states = record(root, "wcs-audio:statechange");

    document.body.appendChild(root);
    await root.connectedCallbackPromise;
    expect(states).toEqual(["running"]);
    root.noteOn(64);
    expect(voices).toEqual([1]);
  });
});

describe("既定の context は最初のユーザー操作まで作らない", () => {
  it("ジェスチャの途中で resume-on-gesture を off にすると、終わっても作らない", async () => {
    const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    gesture("pointerdown");
    root.resumeOnGesture = false;
    gesture("pointerup");
    await nextTask();
    expect(constructed).toHaveLength(0);
  });

  const registry = globalThis as unknown as Record<string, unknown>;
  let originalAudio: unknown;
  let constructed: FakeAudioContext[];

  beforeEach(() => {
    originalAudio = registry.AudioContext;
    releaseSharedContext();
    constructed = [];
    registry.AudioContext = class {
      constructor() {
        const created = new FakeAudioContext();
        constructed.push(created);
        return created;
      }
    };
    setConfig({ createContext: defaultCreateContext });
  });

  afterEach(() => {
    releaseSharedContext();
    if (originalAudio === undefined) delete registry.AudioContext;
    else registry.AudioContext = originalAudio;
    delete (navigator as unknown as Record<string, unknown>).userActivation;
  });

  it("接続しただけでは AudioContext を作らず、state は suspended と読める", async () => {
    const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    await settle();
    expect(constructed).toHaveLength(0);
    expect([root.state, root.running, root.suspended]).toEqual(["suspended", false, true]);
  });

  it("最初のジェスチャの終わり（pointerup の次のタスク）で作って resume し、待っていたグラフを組む", async () => {
    const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    const states = record(root, "wcs-audio:statechange");
    gesture("pointerdown");
    // pointerdown の中では作らない: 作るのも出力が変わるのも、ボタンが上がってクリックが届いた後（music-room）
    await settle();
    expect(constructed).toHaveLength(0);
    expect(states).toEqual([]);
    gesture("pointerup");
    expect(constructed).toHaveLength(0);
    await nextTask();
    expect(constructed).toHaveLength(1);
    await settle();
    expect(root.state).toBe("running");
    expect(constructed[0].nodesOf("osc")).toHaveLength(1);
    // 2 回目以降のジェスチャは作り直さない
    gesture("keydown");
    gesture("pointerdown");
    gesture("pointerup");
    await nextTask();
    expect(constructed).toHaveLength(1);
  });

  it("keydown のジェスチャは次のタスクで作る", async () => {
    const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    gesture("keydown");
    expect(constructed).toHaveLength(0);
    await nextTask();
    expect(constructed).toHaveLength(1);
    await settle();
    expect(root.running).toBe(true);
  });

  it("切断で document のジェスチャのリスナを外す（切断の中の getRootNode() は要素自身）", async () => {
    const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    const removed = vi.spyOn(document, "removeEventListener");
    gesture("pointerdown");
    root.remove();
    const types = removed.mock.calls.map((c) => c[0]);
    removed.mockRestore();
    expect(types).toEqual(expect.arrayContaining(["pointerdown", "keydown", "pointerup", "pointercancel"]));
  });

  it("keydown の直後、作る前に外されたら作らない", async () => {
    const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    gesture("keydown");
    root.remove();
    await nextTask();
    expect(constructed).toHaveLength(0);
  });

  it("pointercancel で終わったジェスチャでも作る", async () => {
    await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    gesture("pointerdown");
    gesture("pointercancel");
    await nextTask();
    expect(constructed).toHaveLength(1);
  });

  it("終わる前に重なったジェスチャでも 1 回だけ作る", async () => {
    await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    gesture("pointerdown");
    gesture("keydown");
    gesture("pointerdown");
    gesture("pointerup");
    gesture("pointerup");
    await nextTask();
    expect(constructed).toHaveLength(1);
  });

  it("ジェスチャの途中の noteOn はその場で作り、終わりで作り直さない", async () => {
    const root = await mount(VOICE_PATCH);
    gesture("pointerdown");
    root.noteOn(60, 0.8); // 画面の鍵盤は pointerdown で鳴らす
    expect(constructed).toHaveLength(1);
    expect(root.voices).toBe(1);
    gesture("pointerup");
    await nextTask();
    expect(constructed).toHaveLength(1);
  });

  it("ジェスチャの途中で外されたら作らず、終わりのリスナも残さない", async () => {
    const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    gesture("pointerdown");
    root.remove();
    gesture("pointerup");
    await nextTask();
    expect(constructed).toHaveLength(0);
    // 戻すと、また最初のジェスチャを待つ
    document.body.appendChild(root);
    await settle();
    expect(constructed).toHaveLength(0);
    gesture("pointerdown");
    gesture("pointerup");
    await nextTask();
    expect(constructed).toHaveLength(1);
  });

  it("待っている間の構造変更は context を作らず、ジェスチャの終わりの時点のマークアップで組む", async () => {
    const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    root.appendChild(document.createElement("wcs-biquad"));
    await settle();
    expect(constructed).toHaveLength(0);
    gesture("pointerdown");
    root.appendChild(document.createElement("wcs-delay"));
    gesture("pointerup");
    await nextTask();
    expect(constructed[0].nodesOf("osc")).toHaveLength(1);
    expect(constructed[0].nodesOf("biquad")).toHaveLength(1);
    expect(constructed[0].nodesOf("delay")).toHaveLength(1);
  });

  it("resume-on-gesture=off ならジェスチャでは作らず、resume() で作る", async () => {
    const root = await mount(`<wcs-audio resume-on-gesture="off"><wcs-osc></wcs-osc></wcs-audio>`);
    gesture("pointerdown");
    gesture("pointerup");
    await nextTask();
    expect(constructed).toHaveLength(0);
    await root.resume();
    expect(constructed).toHaveLength(1);
    expect(root.running).toBe(true);
  });

  it("noteOn が最初の要求なら noteOn で作る（音も voices も noteon も落とさない）", async () => {
    const root = await mount(VOICE_PATCH);
    const voices = record(root, "wcs-audio:voices");
    const notes = record(root, "wcs-audio:noteon");
    root.noteOn(60, 0.8);
    expect(constructed).toHaveLength(1);
    expect(root.voices).toBe(1);
    expect(voices).toEqual([1]);
    expect(notes).toEqual([{ note: 60, velocity: 0.8 }]);
  });

  it("待っている間に外され、外れている間に noteOn が来たら、次の接続で組む", async () => {
    const root = await mount(VOICE_PATCH);
    root.remove();
    root.noteOn(60);
    expect(constructed).toHaveLength(0);
    document.body.appendChild(root);
    await root.connectedCallbackPromise;
    expect(constructed).toHaveLength(1);
  });

  it("ページが既にユーザー操作を受けていれば（userActivation.hasBeenActive）接続時に作る", async () => {
    Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: true }, configurable: true });
    await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    expect(constructed).toHaveLength(1);
    expect(constructed[0].nodesOf("osc")).toHaveLength(1);
  });

  it("共有 context が既にあれば待たずに接続時に組む", async () => {
    const shared = defaultCreateContext() as unknown as FakeAudioContext;
    await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    expect(constructed).toEqual([shared]);
    expect(shared.nodesOf("osc")).toHaveLength(1);
  });

  it("Web Audio が無ければ待たずに unsupported を出す", async () => {
    delete registry.AudioContext;
    const root = await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    expect(root.unsupported).toBe(true);
    expect(root.error).toBe("unsupported");
  });

  it("自前の createContext（OfflineAudioContext など）はジェスチャ無しで接続時に組む", async () => {
    const offline = new FakeAudioContext();
    setConfig({ createContext: () => offline as unknown as BaseAudioContext });
    await mount(`<wcs-audio><wcs-osc></wcs-osc></wcs-audio>`);
    expect(offline.nodesOf("osc")).toHaveLength(1);
    expect(constructed).toHaveLength(0);
  });
});

describe("rebuild が発音中のボイスを切ったら言う（[wcs/audio-voices-cut]）", () => {
  const silence = () => vi.spyOn(console, "warn").mockImplementation(() => {});

  it("<wcs-voice> の poly を変えると、何を変えたか・何声切ったか・直し方を 1 回だけ言う", async () => {
    const warn = silence();
    const root = await mount(VOICE_PATCH);
    const voice = root.querySelector("wcs-voice")!;
    root.noteOn(60);
    voice.setAttribute("poly", "8");
    await settle();
    expect(root.voices).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, target] = warn.mock.calls[0];
    expect(message).toContain("[@wcstack/audio] [wcs/audio-voices-cut]");
    expect(message).toContain('Changing "poly" on <wcs-voice> rebuilt the graph of <wcs-audio> and cut 1 sounding voice.');
    expect(message).toContain('"poly" is structural');
    expect(message).toContain("Bind the live values instead");
    expect(target).toBe(root);

    // ルートごとに 1 回
    root.noteOn(62);
    voice.setAttribute("poly", "6");
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ノードの out を変えて 2 声切ったら、そのタグと属性と数を言う", async () => {
    const warn = silence();
    const root = await mount(`
      <wcs-audio>
        <wcs-voice poly="4"><wcs-osc note><wcs-env></wcs-env></wcs-osc></wcs-voice>
        <wcs-gain id="bus"></wcs-gain>
      </wcs-audio>`);
    root.noteOn(60);
    root.noteOn(64);
    root.querySelector("wcs-osc")!.setAttribute("out", "bus");
    await settle();
    expect(warn.mock.calls[0][0]).toContain('Changing "out" on <wcs-osc> rebuilt the graph of <wcs-audio> and cut 2 sounding voices.');
  });

  it("何も鳴っていなければ言わない（構造を宣言するのは誤りではない）", async () => {
    const warn = silence();
    const root = await mount(VOICE_PATCH);
    root.noteOn(60);
    root.noteOff(60);
    root.querySelector("wcs-voice")!.setAttribute("poly", "2");
    root.appendChild(document.createElement("wcs-gain"));
    await settle();
    expect(warn).not.toHaveBeenCalled();
  });

  it("allNotesOff してから構造を変えれば言わない", async () => {
    const warn = silence();
    const root = await mount(VOICE_PATCH);
    root.noteOn(60);
    root.allNotesOff();
    root.querySelector("wcs-voice")!.setAttribute("poly", "2");
    await settle();
    expect(warn).not.toHaveBeenCalled();
  });

  it("値だけの変更（rebuild しない）では言わない", async () => {
    const warn = silence();
    const root = await mount(VOICE_PATCH);
    root.noteOn(60);
    root.querySelector("wcs-osc")!.setAttribute("type", "square");
    root.requestRebuild();
    await settle();
    expect(root.voices).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("audio タグを足したら「Adding」と、タグを置いたままにする直し方を言う", async () => {
    const warn = silence();
    const root = await mount(VOICE_PATCH);
    root.noteOn(60);
    root.appendChild(document.createElement("wcs-gain"));
    await settle();
    const message = warn.mock.calls[0][0];
    expect(message).toContain("Adding <wcs-gain> rebuilt the graph of <wcs-audio> and cut 1 sounding voice.");
    expect(message).toContain("keep them in place (not under if: or for:)");
  });

  it("構造属性付きのタグをマークアップで差し込んでも「属性の変更」ではなく「Adding」と言う", async () => {
    const warn = silence();
    const root = await mount(`
      <wcs-audio>
        <wcs-voice poly="4"><wcs-osc note><wcs-env></wcs-env></wcs-osc></wcs-voice>
        <wcs-gain id="bus"></wcs-gain>
      </wcs-audio>`);
    root.noteOn(60);
    root.insertAdjacentHTML("beforeend", '<wcs-osc id="sub" out="bus"></wcs-osc>');
    await settle();
    expect(warn.mock.calls[0][0]).toContain("Adding <wcs-osc> rebuilt the graph");
  });

  it("接続より前の構造属性の変化は、その要素の到着として扱う（attributeCause）", () => {
    const osc = document.createElement("wcs-osc");
    expect(attributeCause(osc, "out", false)).toEqual({ element: osc });
    expect(attributeCause(osc, "out", true)).toEqual({ element: osc, attribute: "out" });
  });

  it("<wcs-voice> の poly もマークアップで差し込めば「Adding」（属性の変更とは言わない）", async () => {
    const warn = silence();
    const root = await mount(VOICE_PATCH);
    root.noteOn(60);
    root.insertAdjacentHTML("beforeend", '<wcs-voice poly="2"><wcs-osc note></wcs-osc></wcs-voice>');
    await settle();
    // 最初に届いた到着（voice か中の osc か — upgrade の順は環境による）を名指す
    expect(warn.mock.calls[0][0]).toMatch(/Adding <wcs-(voice|osc)> rebuilt the graph/);
    expect(warn.mock.calls[0][0]).not.toContain('Changing "poly"');
  });

  it("audio タグを外したら「Removing」と言う", async () => {
    const warn = silence();
    const root = await mount(`
      <wcs-audio>
        <wcs-voice poly="4"><wcs-osc note><wcs-env></wcs-env></wcs-osc></wcs-voice>
        <wcs-gain></wcs-gain>
      </wcs-audio>`);
    root.noteOn(60);
    root.querySelector("wcs-gain")!.remove();
    await settle();
    expect(warn.mock.calls[0][0]).toContain("Removing <wcs-gain> rebuilt the graph");
  });

  it("live グラフ（ボイスの外）で押さえている音も 1 声として数える", async () => {
    const warn = silence();
    const root = await mount(`<wcs-audio><wcs-osc note><wcs-env></wcs-env></wcs-osc></wcs-audio>`);
    root.noteOn(60);
    root.noteOn(64);
    root.querySelector("wcs-osc")!.setAttribute("id", "lead");
    await settle();
    expect(warn.mock.calls[0][0]).toContain('Changing "id" on <wcs-osc> rebuilt the graph of <wcs-audio> and cut 1 sounding voice.');
  });

  it("何が変えたか分からない rebuild でも、構造の一般的な直し方を言う", async () => {
    const warn = silence();
    const root = await mount(VOICE_PATCH);
    root.noteOn(60);
    vi.spyOn(root.audioCore, "setPatch").mockReturnValue(true);
    root.requestRebuild();
    await settle();
    const message = warn.mock.calls[0][0];
    expect(message).toContain("A change to the patch's structure rebuilt the graph of <wcs-audio>");
    expect(message).toContain("Structure is declared, not bound");
  });
});
