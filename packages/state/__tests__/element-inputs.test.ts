/**
 * element-inputs.test.ts — what the diagnostics add-on says about a binding to a custom element's member
 * (the music-room seam app, docs/seam-apps.md): a member the element does not declare (#38, with the lint's
 * code `wcs/tag-member-unknown` and the tag), and `undefined` after a value on an input, which state does
 * not write (B8): the element keeps the previous value (`[wcs/input-undefined]`).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, diagnostics, getBindingsReady, installFeatures } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

/** An I/O node's input: `null` (or never set) is its default, 0.5. */
class Delay extends HTMLElement {
  static wcBindable = { protocol: "wc-bindable", version: 1, inputs: [{ name: "mix" }, { name: "time" }] };
  #mix: number | null = null;
  time: unknown = 0;
  get mix(): number {
    return this.#mix ?? 0.5;
  }
  set mix(v: number | null) {
    this.#mix = v;
  }
}

/** A two-way member `value` (the element writes it back). */
class Knob extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [{ name: "value", event: "ei-knob:change" }],
    inputs: [{ name: "value" }],
  };
  value: unknown = 1;
}

/** An input with no getter: what the element keeps cannot be read. */
class Sink extends HTMLElement {
  static wcBindable = { protocol: "wc-bindable", version: 1, inputs: [{ name: "level" }] };
  written: unknown[] = [];
  set level(v: unknown) {
    this.written.push(v);
  }
}

beforeAll(() => {
  customElements.define("ei-delay", Delay);
  customElements.define("ei-knob", Knob);
  customElements.define("ei-sink", Sink);
  installFeatures([diagnostics]);
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`element-inputs-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };
  return { root, el, write };
}

/** The warnings `run` leads to (console.warn, first argument). */
async function warnings(run: () => Promise<unknown> | unknown): Promise<string[]> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await run();
    await flush();
    return warn.mock.calls.map((c) => String(c[0]));
  } finally {
    warn.mockRestore();
  }
}

const said = (binding: string, tag: string, kept: string, path: string): string =>
  `[@wcstack/state] [wcs/input-undefined] "${binding}" on <${tag}> is undefined after a value, and state never writes undefined to an element's input: <${tag}> keeps ${kept}. Write null to clear it (a wcstack I/O node goes back to its default), or give "${path}" a value.`;

describe("宣言されていないメンバーへの束縛（#38 / wcs/tag-member-unknown）", () => {
  it("lint と同じ code とタグを名指し、属性の書き方と lint の案内が付く", async () => {
    customElements.define("ei-env", class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, inputs: [{ name: "attack" }] };
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let message = "";
    try {
      await page(`<ei-env data-wcs="out: envOut"></ei-env>`, { envOut: "filter" });
    } catch (e) {
      message = (e as Error).message;
    } finally {
      error.mockRestore();
    }
    expect(message).toBe(
      '[@wcstack/state] [wcs/tag-member-unknown] "out" is not a wcBindable member of <ei-env>. Bind a property or an input its static wcBindable declares; an attribute of the tag is written in the markup (out="…") or bound as attr.out:. Validate statically: npx @wcstack/lint <file>.',
    );
  });
});

describe("要素の入力に値のあとの undefined（wcs/input-undefined）", () => {
  it("親を書き替えてキーが無くなると、束縛を書いたとおりに名指し、要素が持ち続ける値と直し方を 1 回言う", async () => {
    const { root, write } = await page(`<ei-delay data-wcs="mix: sound.mix; time: sound.time"></ei-delay>`, {
      sound: { mix: 0.3, time: 0.2 },
    });
    const delay = root.querySelector("ei-delay") as Delay;
    expect(delay.mix).toBe(0.3);
    // a stored sound saved before the key existed
    expect(await warnings(() => write((s) => { s.sound = { time: 0.25 }; }))).toEqual([said("mix: sound.mix", "ei-delay", "a number (0.3)", "sound.mix")]);
    // (B8 as before: the element keeps it)
    expect(delay.mix).toBe(0.3);
    expect(delay.time).toBe(0.25);
    // once per binding: a value again, then undefined again, says nothing more
    expect(await warnings(async () => {
      await write((s) => { s.sound = { mix: 0.4, time: 0.25 }; });
      await write((s) => { s.sound = { time: 0.25 }; });
    })).toEqual([]);
    expect(delay.mix).toBe(0.4);
  });

  it("setInitialState で state を入れ替えたときも言う（再設定はすべての束縛を適用し直す）", async () => {
    const { root, el } = await page(`<ei-delay data-wcs="mix: sound.mix"></ei-delay>`, { sound: { mix: 0.3 } });
    expect(await warnings(() => el.setInitialState({ sound: {} }))).toEqual([said("mix: sound.mix", "ei-delay", "a number (0.3)", "sound.mix")]);
    expect((root.querySelector("ei-delay") as Delay).mix).toBe(0.3);
  });

  it("undefined を返し始めた getter も同じ。スプレッドの束縛はメンバーごとの束縛として名指す", async () => {
    const { root, write } = await page(
      `<ei-delay class="g" data-wcs="mix: wet"></ei-delay><ei-delay class="s" data-wcs="...: patch"></ei-delay>`,
      {
        on: true,
        patch: { mix: 0.7, time: 0.1 },
        get wet() { return this.on ? 0.6 : undefined; },
      },
    );
    expect(await warnings(() => write((s) => { s.on = false; }))).toEqual([said("mix: wet", "ei-delay", "a number (0.6)", "wet")]);
    expect((root.querySelector(".g") as Delay).mix).toBe(0.6);
    expect(await warnings(() => write((s) => { s.patch = { time: 0.1 }; }))).toEqual([said("mix: patch.mix", "ei-delay", "a number (0.7)", "patch.mix")]);
  });

  it("束縛ごとに 1 回: 同じパスを読む 2 つの要素はそれぞれ言い、行の束縛も行ごと（新しいオブジェクトの行は新しい要素なので言わない）", async () => {
    const { write } = await page(
      `<ei-delay data-wcs="mix: a.mix"></ei-delay><ei-delay data-wcs="mix: a.mix"></ei-delay>`
      + `<template data-wcs="for: rows"><ei-delay data-wcs="mix: .mix"></ei-delay></template>`,
      { a: { mix: 0.3 }, rows: [{ mix: 0.1 }, { mix: 0.2 }] },
    );
    const w = await warnings(async () => {
      await write((s) => { s.a = {}; });
      await write((s) => { s["rows.0.mix"] = undefined; s["rows.1.mix"] = undefined; });
      // (new objects are new rows: new elements, at their defaults)
      await write((s) => { s.rows = [{ mix: 0.3 }]; });
      await write((s) => { s.rows = [{}]; });
    });
    expect(w).toEqual([
      said("mix: a.mix", "ei-delay", "a number (0.3)", "a.mix"),
      said("mix: a.mix", "ei-delay", "a number (0.3)", "a.mix"),
      said("mix: rows.*.mix", "ei-delay", "a number (0.1)", "rows.*.mix"),
      said("mix: rows.*.mix", "ei-delay", "a number (0.2)", "rows.*.mix"),
    ]);
  });

  it("言わない: 値を持ったことの無い束縛、null（書かれて既定に戻る）とその後の undefined、表示の束縛（textContent:）", async () => {
    const { root, write } = await page(
      `<ei-delay class="never" data-wcs="mix: later.mix"></ei-delay>`
      + `<ei-delay class="cleared" data-wcs="mix: sound.mix"></ei-delay>`
      + `<p data-wcs="textContent: sound.mix"></p>`,
      { later: {}, sound: { mix: 0.3 } },
    );
    const w = await warnings(async () => {
      await write((s) => { s.later = { other: 1 }; });
      await write((s) => { s.sound = { mix: null }; });
      await write((s) => { s.sound = {}; });
    });
    expect(w).toEqual([]);
    expect((root.querySelector(".never") as Delay).mix).toBe(0.5);
    // null is written: the I/O node goes back to its default
    expect((root.querySelector(".cleared") as Delay).mix).toBe(0.5);
    expect(root.querySelector("p")!.textContent).toBe("");
  });

  it("言わない: 要素が自分で undefined を書き戻したとき、要素の値が読めない（getter の無い）入力", async () => {
    const { root, write } = await page(
      `<ei-knob data-wcs="value: knob"></ei-knob><ei-sink data-wcs="level: level"></ei-sink>`,
      { knob: 2, level: 3 },
    );
    const knob = root.querySelector("ei-knob") as Knob;
    const sink = root.querySelector("ei-sink") as Sink;
    expect(knob.value).toBe(2);
    expect(sink.written).toEqual([3]);
    const w = await warnings(async () => {
      knob.value = undefined;
      knob.dispatchEvent(new CustomEvent("ei-knob:change", { detail: undefined }));
      await flush();
      await write((s) => { s.level = undefined; });
    });
    expect(w).toEqual([]);
    expect(sink.written).toEqual([3]);
  });
});
