import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, fire, installDom } from "../src/exports";

// 綴り違いの option は何もしなかった: mount(html, { resolveModul }) は後で Node の
// ERR_UNSUPPORTED_ESM_URL_SCHEME で落ちた（docs/seam-apps.md、homeroom）。bootstrapXxx() と同じく拒む。

const HTML = `<wcs-state json='{"n": 1}'></wcs-state><b data-wcs="textContent: n"></b>`;
const MOUNT_LIST =
  `Its options: root ("document" or "shadow"), bootstrap (an array of functions), stateTagName (a string), ` +
  `maxIterations (a number), resolveModule (a function).`;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mount() の option の検査", () => {
  it("持たない option は、文書に触れる前に名前と option の一覧を言って拒む", async () => {
    document.body.innerHTML = `<p id="keep"></p>`;
    const bootstrap = vi.fn();
    const options = { bootstrap: [bootstrap], resolveModul: () => null } as never;
    await expect(mount(HTML, options)).rejects.toThrow(
      `@wcstack/testing: mount(): "resolveModul" is not one of its options, or not of the option's type. ${MOUNT_LIST}`,
    );
    expect(bootstrap).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(`<p id="keep"></p>`);
  });

  it.each([
    ["root", "Shadow"],
    ["root", null],
    ["bootstrap", () => {}],
    ["bootstrap", [() => {}, "bootstrapRouter"]],
    ["stateTagName", 1],
    ["maxIterations", "10"],
    ["resolveModule", "./state.js"],
  ])("型の違う値も拒む: %s = %j", async (name, value) => {
    await expect(mount(HTML, { [name]: value } as never)).rejects.toThrow(
      `@wcstack/testing: mount(): "${name}" is not one of its options, or not of the option's type.`,
    );
  });

  it("undefined の option は飛ばす", async () => {
    const app = await mount(HTML, { root: undefined, resolveModule: undefined, maxIterations: undefined });
    expect(app.root.querySelector("b")!.textContent).toBe("1");
  });

  it("オブジェクトでない options は拒む", async () => {
    await expect(mount(HTML, null as never)).rejects.toThrow(`@wcstack/testing: mount(): its options must be an object. ${MOUNT_LIST}`);
    await expect(mount(HTML, [] as never)).rejects.toThrow(/its options must be an object/);
  });
});

describe("fire() の init の検査", () => {
  it("Event に届かないキーは、イベントを送る前に拒み、別のイベントクラスの送り方を言う", () => {
    const el = document.createElement("input");
    const seen = vi.fn();
    el.addEventListener("keydown", seen);
    expect(() => fire(el, "keydown", { key: "Enter" } as never)).toThrow(
      `@wcstack/testing: fire(): "key" is not one of its options, or not of the option's type. ` +
      `Its options: bubbles (a boolean), cancelable (a boolean), composed (a boolean), detail (any value). ` +
      `fire() dispatches an Event, or a CustomEvent with detail; for another event class (KeyboardEvent, InputEvent, …) call target.dispatchEvent() yourself.`,
    );
    expect(() => fire(el, "keydown", { bubbles: "yes" } as never)).toThrow(/"bubbles" is not one of its options/);
    expect(() => fire(el, "keydown", null as never)).toThrow(/fire\(\): its options must be an object/);
    expect(seen).not.toHaveBeenCalled();
  });

  it("持っているキーと undefined は通す", () => {
    const el = document.createElement("div");
    const seen: Event[] = [];
    el.addEventListener("ping", (e) => seen.push(e));
    expect(fire(el, "ping", { bubbles: false, cancelable: true, composed: true, detail: undefined })).toBe(true);
    expect(fire(el, "ping", { detail: null })).toBe(true);
    expect(seen[0]).not.toBeInstanceOf(CustomEvent);
    expect(seen[0].composed).toBe(true);
    expect((seen[1] as CustomEvent).detail).toBeNull();
  });
});

describe("installDom() の option の検査", () => {
  it("持たない option、型の違う値は、グローバルに触れる前に拒む", async () => {
    const before = globalThis.document;
    await expect(installDom({ windw: {} } as never)).rejects.toThrow(
      `@wcstack/testing: installDom(): "windw" is not one of its options, or not of the option's type. ` +
      `Its options: url (a string), window (a happy-dom Window).`,
    );
    await expect(installDom({ url: new URL("http://localhost/") } as never)).rejects.toThrow(/"url" is not one of its options/);
    await expect(installDom({ window: null } as never)).rejects.toThrow(/"window" is not one of its options/);
    expect(globalThis.document).toBe(before);
  });
});
