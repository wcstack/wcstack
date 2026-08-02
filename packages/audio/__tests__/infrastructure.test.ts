import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { defaultCreateContext, releaseSharedContext } from "../src/core/audioContext";
import { PROPS } from "../src/core/builders";
import { applyNodeStyles, resetNodeStyles } from "../src/patch/nodeStyles";
import { structureKey } from "../src/patch/structureKey";
import { WcsAudio } from "../src/components/Audio";
import { WcsBiquad, WcsLfo, WcsOsc } from "../src/components/nodes";
import { WcsVoice } from "../src/components/Voice";
import { VoiceAllocator } from "../src/core/VoiceAllocator";
import { registerComponents } from "../src/registerComponents";
import { setConfig } from "../src/config";
import { getStates } from "./helpers";
import { FakeAudioContext, resetNodeIds } from "./FakeAudioContext";

const SHARED = Symbol.for("@wcstack/audio.context");

describe("audioContext（既定のコンテキスト供給）", () => {
  const registry = globalThis as unknown as Record<string | symbol, unknown>;
  let originalAudio: unknown;
  let originalWebkit: unknown;

  beforeEach(() => {
    originalAudio = registry.AudioContext;
    originalWebkit = registry.webkitAudioContext;
    releaseSharedContext();
  });

  afterEach(() => {
    releaseSharedContext();
    if (originalAudio === undefined) delete registry.AudioContext;
    else registry.AudioContext = originalAudio;
    if (originalWebkit === undefined) delete registry.webkitAudioContext;
    else registry.webkitAudioContext = originalWebkit;
  });

  it("Web Audio が無い環境では null を返す（throw しない）", () => {
    delete registry.AudioContext;
    delete registry.webkitAudioContext;
    expect(defaultCreateContext()).toBeNull();
  });

  it("AudioContext を1つだけ作り、以後は同じものを返す", () => {
    let constructed = 0;
    registry.AudioContext = class { constructor() { constructed++; } } as never;
    const first = defaultCreateContext();
    const second = defaultCreateContext();
    expect(constructed).toBe(1);
    expect(first).toBe(second);
  });

  it("webkitAudioContext にフォールバックする", () => {
    delete registry.AudioContext;
    registry.webkitAudioContext = class {} as never;
    expect(defaultCreateContext()).not.toBeNull();
  });

  // 版が混在した CDN ページでも context が分裂しないための仕掛け。
  it("Symbol.for レジストリ経由なので別コピーからも同じ context に届く", () => {
    registry.AudioContext = class {} as never;
    const ctx = defaultCreateContext();
    expect(registry[SHARED]).toBe(ctx);
    releaseSharedContext();
    expect(registry[SHARED]).toBeUndefined();
  });
});

describe("nodeStyles", () => {
  afterEach(() => {
    resetNodeStyles(document);
  });

  it("同じ root には一度しか adopt しない", () => {
    const doc = document as unknown as { adoptedStyleSheets: CSSStyleSheet[] };
    if (!Array.isArray(doc.adoptedStyleSheets)) {
      // happy-dom に adoptedStyleSheets が無い環境では静かに諦める挙動を見る
      expect(() => applyNodeStyles(document)).not.toThrow();
      return;
    }
    const before = doc.adoptedStyleSheets.length;
    applyNodeStyles(document);
    applyNodeStyles(document);
    expect(doc.adoptedStyleSheets.length).toBe(before + 1);
  });

  it("adoptedStyleSheets の無い root では何もしない（never-throw）", () => {
    const fake = {} as unknown as Document;
    expect(() => applyNodeStyles(fake)).not.toThrow();
  });

  it("CSSStyleSheet の生成に失敗しても throw しない", () => {
    const root = { adoptedStyleSheets: [] } as unknown as Document;
    const original = globalThis.CSSStyleSheet;
    (globalThis as { CSSStyleSheet?: unknown }).CSSStyleSheet = class {
      replaceSync(): void { throw new Error("not supported"); }
    };
    try {
      expect(() => applyNodeStyles(root)).not.toThrow();
    } finally {
      (globalThis as { CSSStyleSheet?: unknown }).CSSStyleSheet = original;
    }
  });
});

describe("structureKey", () => {
  it("何も持たないノードでも安定したキーを作る", () => {
    expect(structureKey({ nodes: [{ kind: "gain", key: "g" }] })).toBe("gain#g@|||0|0()||");
  });

  it("voices を省略しても voices: [] と同じキーになる", () => {
    const patch = { nodes: [{ kind: "gain" as const, key: "g" }] };
    expect(structureKey(patch)).toBe(structureKey({ ...patch, voices: [] }));
  });

  it("nodes を省略しても空パッチと同じキーになる", () => {
    expect(structureKey({ nodes: [] })).toBe(structureKey({ nodes: [], voices: [] }));
  });

  it("voice の nodes 省略も扱える", () => {
    expect(() => structureKey({ nodes: [], voices: [{ key: "v", poly: 2, nodes: [] }] })).not.toThrow();
  });

  it("id / out / param / note / master の違いを区別する", () => {
    const base = { nodes: [{ kind: "osc" as const, key: "o" }] };
    const keys = new Set([
      structureKey(base),
      structureKey({ nodes: [{ kind: "osc", key: "o", id: "x" }] }),
      structureKey({ nodes: [{ kind: "osc", key: "o", out: ["x"] }] }),
      structureKey({ nodes: [{ kind: "osc", key: "o", param: "x" }] }),
      structureKey({ nodes: [{ kind: "osc", key: "o", note: true }] }),
      structureKey({ nodes: [{ kind: "osc", key: "o", master: true }] }),
    ]);
    expect(keys.size).toBe(6);
  });
});

describe("ノードタグの never-throw", () => {
  it("不正な biquad / lfo の type は無視される", () => {
    const ctx = new FakeAudioContext();
    const biquad = ctx.createBiquadFilter();
    Object.defineProperty(biquad, "type", {
      get: () => "lowpass",
      set: () => { throw new TypeError("bad"); },
    });
    const lfoOsc = ctx.createOscillator();
    Object.defineProperty(lfoOsc, "type", {
      get: () => "sine",
      set: () => { throw new TypeError("bad"); },
    });
    // PROPS の setter を直接叩いて never-throw を確認する。
    expect(() => PROPS.biquad.type({ filter: biquad } as never, "nope")).not.toThrow();
    expect(() => PROPS.lfo.type({ osc: lfoOsc } as never, "nope")).not.toThrow();
  });
});

describe("VoiceAllocator", () => {
  const allocation = (ctx: FakeAudioContext, note: number) => ({
    note, instances: new Map(), gates: [], gain: ctx.createGain(),
    released: false, freeAt: Infinity,
  });

  it("同じ割り当ての二重 dispose は安全", () => {
    const ctx = new FakeAudioContext();
    const allocator = new VoiceAllocator({ key: "v", poly: 2, nodes: [] });
    const a = allocation(ctx, 60);
    allocator.add(a);
    allocator.dispose(a);
    expect(() => allocator.dispose(a)).not.toThrow();
    expect(allocator.allocated).toBe(0);
  });

  it("poly は最低 1 に丸められる", () => {
    expect(new VoiceAllocator({ key: "v", poly: -3, nodes: [] }).poly).toBe(1);
  });

  it("oldest は sounding が無ければ undefined", () => {
    const allocator = new VoiceAllocator({ key: "v", poly: 2, nodes: [] });
    expect(allocator.oldest()).toBeUndefined();
  });
});

describe("CustomStateSet (:state()) reflection", () => {
  let ctx: FakeAudioContext;

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
  });

  const make = (): WcsAudio => {
    const el = document.createElement("wcs-audio") as WcsAudio;
    document.body.appendChild(el);
    return el;
  };

  const dispatch = (el: WcsAudio, event: string, detail: unknown): void => {
    el.dispatchEvent(new CustomEvent(event, { detail }));
  };

  it("statechange で running / suspended / unsupported が排他的に切り替わる", () => {
    const el = make();
    dispatch(el, "wcs-audio:statechange", "running");
    expect(getStates(el)).toEqual(new Set(["running"]));
    dispatch(el, "wcs-audio:statechange", "suspended");
    expect(getStates(el)).toEqual(new Set(["suspended"]));
    dispatch(el, "wcs-audio:statechange", "unsupported");
    expect(getStates(el)).toEqual(new Set(["unsupported"]));
  });

  it("error の有無が :state(error) に反映される", () => {
    const el = make();
    dispatch(el, "wcs-audio:error", "boom");
    expect(el.debugStates).toContain("error");
    dispatch(el, "wcs-audio:error", null);
    expect(el.debugStates).not.toContain("error");
  });

  it("debugStates はスナップショットを返す", () => {
    const el = make();
    dispatch(el, "wcs-audio:statechange", "running");
    const snapshot = el.debugStates;
    snapshot.push("tampered");
    expect(el.debugStates).toEqual(["running"]);
  });

  it("debug-states 属性ありで data-wcs-state-* がトグルされる", () => {
    const el = make();
    el.setAttribute("debug-states", "");
    dispatch(el, "wcs-audio:statechange", "running");
    expect(el.hasAttribute("data-wcs-state-running")).toBe(true);
    dispatch(el, "wcs-audio:statechange", "suspended");
    expect(el.hasAttribute("data-wcs-state-running")).toBe(false);
  });

  it("attachInternals 不在でも throw せず debugStates は空", () => {
    const proto = HTMLElement.prototype as unknown as { attachInternals?: unknown };
    const original = proto.attachInternals;
    delete proto.attachInternals;
    let el!: WcsAudio;
    try {
      expect(() => { el = document.createElement("wcs-audio") as WcsAudio; }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }
    expect(el.debugStates).toEqual([]);
    expect(() => dispatch(el, "wcs-audio:statechange", "running")).not.toThrow();
  });

  it("probe が SyntaxError を投げる環境でも動作継続する", () => {
    const proto = HTMLElement.prototype as unknown as { attachInternals?: unknown };
    const original = proto.attachInternals;
    proto.attachInternals = function (): ElementInternals {
      return {
        states: {
          add: () => { throw new DOMException("bad state name", "SyntaxError"); },
          delete: () => {},
          has: () => false,
        },
      } as unknown as ElementInternals;
    };
    let el!: WcsAudio;
    try {
      expect(() => { el = document.createElement("wcs-audio") as WcsAudio; }).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }
    expect(el.debugStates).toEqual([]);
  });

  it("states.add が個別に throw しても never-throw を維持する", () => {
    const proto = HTMLElement.prototype as unknown as { attachInternals?: unknown };
    const original = proto.attachInternals;
    let probing = true;
    proto.attachInternals = function (): ElementInternals {
      return {
        states: {
          add: () => { if (!probing) throw new DOMException("nope", "SyntaxError"); },
          delete: () => {},
          has: () => false,
        },
      } as unknown as ElementInternals;
    };
    let el!: WcsAudio;
    try {
      el = document.createElement("wcs-audio") as WcsAudio;
      document.body.appendChild(el);
      probing = false;
      expect(() => dispatch(el, "wcs-audio:statechange", "running")).not.toThrow();
    } finally {
      proto.attachInternals = original;
    }
  });
});

describe("ルート外・属性の端条件", () => {
  beforeAll(() => {
    registerComponents();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("<wcs-voice> の同値な属性書き込みは何もしない", () => {
    const voice = document.createElement("wcs-voice") as WcsVoice;
    document.body.appendChild(voice);
    voice.setAttribute("poly", "4");
    expect(() => voice.setAttribute("poly", "4")).not.toThrow();
  });

  it("ルート外のノードタグでも属性変更が throw しない", () => {
    const osc = document.createElement("wcs-osc") as WcsOsc;
    document.body.appendChild(osc);
    expect(() => {
      osc.setAttribute("frequency", "880");
      osc.setAttribute("type", "square");
      osc.setAttribute("out", "bus");
    }).not.toThrow();
  });

  it("非数値属性を消しても Core は触られない", () => {
    const osc = document.createElement("wcs-osc") as WcsOsc;
    osc.setAttribute("type", "square");
    document.body.appendChild(osc);
    expect(() => osc.removeAttribute("type")).not.toThrow();
  });

  it("ノードタグの getter は属性が無ければ既定値 / 空文字を返す", () => {
    const osc = document.createElement("wcs-osc") as WcsOsc & { frequency: number; type: string };
    expect(osc.frequency).toBe(440);
    expect(osc.type).toBe("");
    const biquad = document.createElement("wcs-biquad") as WcsBiquad & { q: number };
    expect(biquad.q).toBe(1);
    const lfo = document.createElement("wcs-lfo") as WcsLfo & { rate: number; depth: number };
    expect(lfo.rate).toBe(5);
    expect(lfo.depth).toBe(10);
  });
});
