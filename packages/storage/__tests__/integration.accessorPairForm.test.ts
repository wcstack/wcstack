import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { bootstrapState, getBindingsReady } from "@wcstack/state";
import { registerComponents } from "../src/registerComponents";

/**
 * README「2. Persisting a form as one object」の正規パターンを実 @wcstack/state で固定する。
 *
 * 形: 複数の入力欄（`form.name` / `form.email`）を 1 つの localStorage キーにまとめて
 * 保存・復元する。getter `formSnapshot` が各フィールドを `this` 経由で読むので、どの
 * フィールドが変わっても再評価 → `<wcs-storage value>` へ流れて write-through 保存される。
 * setter `formSnapshot` が復元経路（`#init=element` で要素のロード済み値が初回に流れ込む）。
 *
 * これは #234（アクセサペアへの書き込みが getter キャッシュに代入値を固定していた）の
 * 修理後に初めて成立するパターンなので、退行検知としても置く。
 */

const KEY = "signup-form";

function defineForm(counter: { setterCalls: number }) {
  return {
    form: { name: "", email: "" },
    // フィールドは *パスで* 読む。`this.form.name` は `form` しか追跡しないので、
    // 入力欄の編集で getter が再評価されない（state README「依存追跡の境界」）。
    get formSnapshot() {
      return { name: this["form.name"], email: this["form.email"] };
    },
    set formSnapshot(v: any) {
      counter.setterCalls++;
      if (v) this.form = { ...this.form, ...v };
    },
  };
}

function readForm(stateEl: any): { name: string; email: string } {
  let snapshot: any = null;
  stateEl.createState("readonly", (s: any) => { snapshot = { ...s.form }; });
  return snapshot;
}

async function mount(): Promise<{ host: HTMLElement; stateEl: any; name: HTMLInputElement; email: HTMLInputElement; storage: any; setterCalls: () => number }> {
  const host = document.createElement("div");
  host.innerHTML = `
    <wcs-storage key="${KEY}" type="local" data-wcs="value#init=element: formSnapshot"></wcs-storage>
    <input class="name" data-wcs="value: form.name">
    <input class="email" data-wcs="value: form.email">
    <wcs-state></wcs-state>
  `;
  document.body.appendChild(host);
  const stateEl = host.querySelector("wcs-state") as any;
  const counter = { setterCalls: 0 };
  stateEl.setInitialState(defineForm(counter));
  await stateEl.connectedCallbackPromise;
  await getBindingsReady(document);
  return {
    host,
    stateEl,
    name: host.querySelector("input.name") as HTMLInputElement,
    email: host.querySelector("input.email") as HTMLInputElement,
    storage: host.querySelector("wcs-storage"),
    setterCalls: () => counter.setterCalls,
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

function typeInto(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeAll(() => {
  bootstrapState();
  registerComponents();
});

let host: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  host?.remove();
  host = null;
});

describe("integration: フォームをアクセサペア 1 つで保存・復元する（README §2）", () => {
  it("永続化済みのオブジェクトが setter 経由で復元され、各入力欄に届く", async () => {
    localStorage.setItem(KEY, JSON.stringify({ name: "Ada", email: "ada@example.com" }));
    const m = await mount();
    host = m.host;

    expect(m.name.value).toBe("Ada");
    expect(m.email.value).toBe("ada@example.com");
    expect(readForm(m.stateEl)).toEqual({ name: "Ada", email: "ada@example.com" });
    // 復元後の再保存は同じ内容（永続化済みデータは上書きされない）
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("空キーでは null が setter に渡り、state の初期値が保たれる", async () => {
    const m = await mount();
    host = m.host;

    expect(m.name.value).toBe("");
    expect(readForm(m.stateEl)).toEqual({ name: "", email: "" });
    // null の書き込みでも getter は再評価される（アクセサペアの書き込みは dirty 化）ので、
    // 初回に seed が 1 回だけ書かれる。README §2 に明記した挙動。
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ name: "", email: "" });
  });

  it("どのフィールドを変えても getter が再評価され、オブジェクト全体が保存される", async () => {
    localStorage.setItem(KEY, JSON.stringify({ name: "Ada", email: "ada@example.com" }));
    const m = await mount();
    host = m.host;

    typeInto(m.name, "Grace");
    await tick();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ name: "Grace", email: "ada@example.com" });

    typeInto(m.email, "grace@example.com");
    await tick();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ name: "Grace", email: "grace@example.com" });
  });

  it("保存 → value-changed の往復が setter を再帰させず、要素と state が一致して止まる", async () => {
    const m = await mount();
    host = m.host;

    typeInto(m.name, "Linus");
    await tick();
    await tick();

    expect(m.storage.value).toEqual({ name: "Linus", email: "" });
    expect(readForm(m.stateEl)).toEqual({ name: "Linus", email: "" });
    // 保存が dispatch する value-changed は同一参照の書き戻し（write confirmation）として
    // 止まり、setter は初回の #init=element の 1 回しか呼ばれない
    expect(m.setterCalls()).toBe(1);
    // 2 回目の書き込みも前回の値に固定されない（#234 の退行検知）
    typeInto(m.name, "Margaret");
    await tick();
    expect(JSON.parse(localStorage.getItem(KEY)!).name).toBe("Margaret");
  });
});
