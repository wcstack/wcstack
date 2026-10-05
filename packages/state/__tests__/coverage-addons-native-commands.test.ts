/**
 * coverage-addons-native-commands.test.ts — the native-commands add-on (src/native/commands.ts,
 * src/features/native-commands.ts): `command.<method>:` on a native element, through the core's
 * `hooks.nativeCommand` (src/dom/wc.ts attachCommand). The core and this add-on only (no
 * diagnostics): errors read as numbered messages.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, nativeCommands } from "../src/index";
import { M } from "../src/messages";
import { NATIVE_COMMANDS, nativeCommandsOf } from "../src/native/commands";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;
const EVERY = NATIVE_COMMANDS["*"].join(", ");

beforeAll(() => {
  installFeatures([nativeCommands]);
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-native-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  /** Runs `fn` on a writable state and returns what it returned (an emit's results). */
  const run = (fn: (s: any) => unknown): unknown => {
    let r: unknown;
    el.createState("writable", (s: any) => { r = fn(s); });
    return r;
  };
  return { h, root, el, run };
}

/** The message the page's initialization fails with. */
async function failure(html: string, state: Record<string, any>): Promise<string> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await page(html, state);
    return "(no error)";
  } catch (e) {
    return (e as Error).message;
  } finally {
    error.mockRestore();
  }
}

describe("ネイティブ要素の command.（native-commands）", () => {
  it("state の emit で <dialog> の showModal / close が呼ばれ、引数はそのまま渡る", async () => {
    const { root, run } = await page(
      `<dialog data-wcs="command.showModal: $command.open; command.close: $command.close"></dialog>`,
      { $commandTokens: ["open", "close"] },
    );
    const dialog = root.querySelector("dialog")!;
    run((s) => s.$command.open.emit());
    expect(dialog.open).toBe(true);
    run((s) => s.$command.close.emit("saved"));
    expect(dialog.open).toBe(false);
    expect(dialog.returnValue).toBe("saved");
  });

  it("state の emit が渡したオプションは、そのままメソッドに届く", async () => {
    const { root, run } = await page(`<p data-wcs="command.scrollIntoView: $command.reveal">x</p>`, { $commandTokens: ["reveal"] });
    const p = root.querySelector("p")!;
    const spy = vi.spyOn(p, "scrollIntoView").mockImplementation(() => {});
    run((s) => s.$command.reveal.emit({ block: "center" }));
    expect(spy).toHaveBeenCalledWith({ block: "center" });
  });

  it("<input> の focus が state から呼べる", async () => {
    const { root, run } = await page(`<input data-wcs="command.focus: $command.focusName">`, { $commandTokens: ["focusName"] });
    run((s) => s.$command.focusName.emit());
    expect(root.activeElement).toBe(root.querySelector("input"));
  });

  it("on…: $command.x の emit（イベントと行のインデックス）は、引数にしないで呼ぶ", async () => {
    const { root } = await page(
      `<template data-wcs="for: items"><button data-wcs="onclick: $command.close">x</button></template>
       <dialog data-wcs="command.close: $command.close"></dialog>`,
      { $commandTokens: ["close"], items: [1, 2] },
    );
    const dialog = root.querySelector("dialog")!;
    const spy = vi.spyOn(dialog, "close");
    root.querySelectorAll("button")[1].click();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([]);
    expect(dialog.returnValue).toBe("");
  });

  it("第 1 引数が Event なら、state からの emit でも引数にしない", async () => {
    const { root, run } = await page(`<input data-wcs="command.setCustomValidity: $command.check">`, { $commandTokens: ["check"] });
    const spy = vi.spyOn(root.querySelector("input")!, "setCustomValidity");
    run((s) => s.$command.check.emit(new Event("change"), "too short"));
    expect(spy.mock.calls).toEqual([[]]);
    run((s) => s.$command.check.emit("too short"));
    expect(spy.mock.calls[1]).toEqual(["too short"]);
  });

  it("emit はメソッドの戻り値を返す", async () => {
    const { root, run } = await page(
      `<input data-wcs="command.checkValidity: $command.check"><form data-wcs="command.checkValidity: $command.check"></form>`,
      { $commandTokens: ["check"] },
    );
    vi.spyOn(root.querySelector("input")!, "checkValidity").mockReturnValue(false);
    vi.spyOn(root.querySelector("form")!, "checkValidity").mockReturnValue(true);
    expect(run((s) => s.$command.check.emit())).toEqual([false, true]);
  });

  it("投げたメソッドは token 名つきで報告され、ほかの購読者には届く", async () => {
    const { root, run } = await page(
      `<dialog data-wcs="command.showModal: $command.open"></dialog><video data-wcs="command.play: $command.open"></video>`,
      { $commandTokens: ["open"] },
    );
    vi.spyOn(root.querySelector("dialog")!, "showModal").mockImplementation(() => { throw new Error("InvalidStateError"); });
    const play = vi.spyOn(root.querySelector("video")!, "play").mockImplementation(() => Promise.resolve());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const results = run((s) => s.$command.open.emit()) as unknown[];
      expect(results[0]).toBeUndefined();
      expect(play).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(`[@wcstack/state] #${M.TokenSubscriberThrew} "open"`, expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });

  it("文書から外れている間の emit は呼ばずに購読を保ち、戻ればまた呼ぶ", async () => {
    const { root, run } = await page(`<main><input data-wcs="command.select: $command.pick"></main>`, { $commandTokens: ["pick"] });
    const input = root.querySelector("input")!;
    const spy = vi.spyOn(input, "select");
    const main = root.querySelector("main")!;
    input.remove();
    expect(run((s) => s.$command.pick.emit())).toEqual([undefined]);
    expect(spy).not.toHaveBeenCalled();
    main.append(input);
    run((s) => s.$command.pick.emit());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("描画は後から走る: 表示を変えたハンドラの中の emit は届かず、$renderedCallback からの emit は届く", async () => {
    const { root, run } = await page(
      `<template data-wcs="if: editing"><input data-wcs="command.focus: $command.focusTitle"></template>`,
      {
        editing: false,
        early: false,
        $commandTokens: ["focusTitle"],
        startEdit() {
          this.editing = true;
          this.$command.focusTitle.emit();
        },
        $renderedCallback(paths: string[]) {
          if (!this.early && paths.includes("editing") && this.editing) this.$command.focusTitle.emit();
        },
      },
    );
    const focus = vi.spyOn(HTMLInputElement.prototype, "focus");
    try {
      run((s) => { s.early = true; s.startEdit(); });
      await flush();
      // the branch was built after the emit: nothing was subscribed, nothing focused
      expect(root.querySelector("input")).not.toBeNull();
      expect(focus).not.toHaveBeenCalled();
      run((s) => { s.editing = false; s.early = false; });
      await flush();
      run((s) => s.startEdit());
      await flush();
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus.mock.contexts[0]).toBe(root.querySelector("input"));
    } finally {
      focus.mockRestore();
    }
  });

  it("行が消えると、行の中のネイティブ要素の購読も解く", async () => {
    const { el, run } = await page(
      `<template data-wcs="for: items"><input data-wcs="command.focus: $command.focus"></template>`,
      { $commandTokens: ["focus"], items: [1, 2] },
    );
    expect(run((s) => s.$command.focus.size)).toBe(2);
    el.createState("writable", (s: any) => { s.items = [1]; });
    await flush();
    expect(run((s) => s.$command.focus.size)).toBe(1);
  });
});

describe("呼べるメソッドの表", () => {
  it("表に無いメソッドは #1205 で初期化に失敗し、要素とメソッドと、その要素に呼べるものを名指す", async () => {
    for (const method of ["remove", "setAttribute", "insertAdjacentHTML", "submit"]) {
      const message = await failure(`<form data-wcs="command.${method}: $command.t"></form>`, { $commandTokens: ["t"] });
      expect(message).toBe(`[@wcstack/state] #${M.NativeNoCommand} "form" "${method}" "${EVERY}, requestSubmit, checkValidity, reportValidity"`);
    }
  });

  it("ほかの要素の行のメソッドは呼べない（<div> の showModal、<input> の play）", async () => {
    expect(await failure(`<div data-wcs="command.showModal: $command.t"></div>`, { $commandTokens: ["t"] }))
      .toBe(`[@wcstack/state] #${M.NativeNoCommand} "div" "showModal" "${EVERY}"`);
    expect(await failure(`<input data-wcs="command.play: $command.t">`, { $commandTokens: ["t"] }))
      .toMatch(`#${M.NativeNoCommand} "input" "play"`);
  });

  it("表は要素名の自身の行だけを引く（<constructor> で Object.prototype を読まない）", async () => {
    expect(nativeCommandsOf("constructor")).toEqual(NATIVE_COMMANDS["*"]);
    expect(nativeCommandsOf("__proto__")).toEqual(NATIVE_COMMANDS["*"]);
    expect(await failure(`<constructor data-wcs="command.valueOf: $command.t"></constructor>`, { $commandTokens: ["t"] }))
      .toMatch(`#${M.NativeNoCommand} "constructor" "valueOf"`);
    const { root, run } = await page(`<constructor tabindex="0" data-wcs="command.focus: $command.t"></constructor>`, { $commandTokens: ["t"] });
    run((s) => s.$command.t.emit());
    expect(root.activeElement).toBe(root.querySelector("constructor"));
  });

  it("要素がメソッドを持つかは見ない: 表にあれば束縛でき、持たなければ呼んだときに報告する", async () => {
    const { root, run } = await page(`<dialog data-wcs="command.requestClose: $command.t"></dialog>`, { $commandTokens: ["t"] });
    const dialog = root.querySelector("dialog") as any;
    // a browser without requestClose
    dialog.requestClose = undefined;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      run((s) => s.$command.t.emit());
      expect(error).toHaveBeenCalledWith(`[@wcstack/state] #${M.TokenSubscriberThrew} "t"`, expect.any(TypeError));
    } finally {
      error.mockRestore();
    }
  });

  it("行の中の表に無いメソッドは、束縛 1 本の失敗として $errorCallback に届き、行は作られる", async () => {
    const errors: string[] = [];
    const { root } = await page(
      `<template data-wcs="for: items"><p>{{ . }}</p><input data-wcs="command.stepUp: $command.t"></template>`,
      { $commandTokens: ["t"], items: ["a"], $errorCallback(e: Error) { errors.push(e.message); } },
    );
    expect(root.querySelector("p")!.textContent).toBe("a");
    expect(errors).toEqual([expect.stringContaining(`#${M.NativeNoCommand} "input" "stepUp"`)]);
  });

  it("wcBindable の無いカスタム要素は、後付けがあっても従来どおり #1202", async () => {
    const tag = `cov-native-el-${seq++}`;
    customElements.define(tag, class extends HTMLElement {});
    expect(await failure(`<${tag} data-wcs="command.focus: $command.t"></${tag}>`, { $commandTokens: ["t"] }))
      .toBe(`[@wcstack/state] #${M.NoBindable} "${tag}" "command.focus"`);
  });

  it("wcBindable を持つカスタム要素は、宣言したコマンドだけを呼ぶ（表は使わない）", async () => {
    const tag = `cov-native-el-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], commands: [{ name: "go" }] };
      go(...args: unknown[]): unknown[] { return args; }
    });
    expect(await failure(`<${tag} data-wcs="command.focus: $command.t"></${tag}>`, { $commandTokens: ["t"] }))
      .toBe(`[@wcstack/state] #${M.NoCommand} "${tag}" "focus"`);
    // the event is passed to a custom element's method, as before
    const { root, run } = await page(`<${tag} data-wcs="command.go: $command.t"></${tag}>`, { $commandTokens: ["t"] });
    const e = new Event("x");
    expect(run((s) => s.$command.t.emit(e, 1))).toEqual([[e, 1]]);
    expect(root.querySelector(tag)).not.toBeNull();
  });
});
