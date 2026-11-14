/**
 * forms-late-install.test.ts — the forms add-on (src/features/forms.ts) installed after a state was bound: a
 * split page that loads the add-on later. It takes the engine's class from the first engine that drains, and
 * knows a control from its next change.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, forms, getBindingsReady, installFeatures } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  installFeatures([]);
  bootstrapState();
});

describe("forms add-on: 状態を束ねた後で入れたとき", () => {
  it("次の drain から働く: 変換中の欄は預かり、その後に変わった欄は reset で state と合う", async () => {
    const h = document.createElement("forms-late-page");
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><form><input id="a" data-wcs="value: a"><input id="b" data-wcs="value: b"></form>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ a: "A", b: "B" });
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    const write = async (fn: (s: any) => void) => { el.createState("writable", fn); await flush(); };
    const read = (key: string) => { let v: unknown; el.createState("readonly", (s: any) => { v = s[key]; }); return v; };
    const a = root.querySelector("#a") as HTMLInputElement;
    const b = root.querySelector("#b") as HTMLInputElement;

    installFeatures([forms]);
    // (nothing yet: the add-on has seen no engine)
    await write((s) => { s.a = "A2"; });
    expect(a.value).toBe("A2");
    // the drain above gave it the engine: the next change of a field makes it known
    await write((s) => { s.a = "A3"; });
    a.focus();
    a.dispatchEvent(new Event("compositionstart", { bubbles: true, composed: true }));
    await write((s) => { s.a = "held"; });
    expect(a.value).toBe("A3");
    a.dispatchEvent(new Event("compositionend", { bubbles: true, composed: true }));
    await flush();
    await flush();
    expect(a.value).toBe("held");
    // a reset: the field known since tells state; the one never applied since stays as the reset left it
    (root.querySelector("form") as HTMLFormElement).reset();
    await flush();
    await flush();
    expect([read("a"), read("b"), b.value]).toEqual(["", "B", ""]);
  });
});
